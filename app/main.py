from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, UploadFile, File
from typing import List
from fastapi.templating import Jinja2Templates
from datetime import datetime
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, StreamingResponse, RedirectResponse
from starlette.middleware.sessions import SessionMiddleware
import pandas as pd
import os
import json
import asyncio
import threading
import shutil
import time
import uuid
from dotenv import load_dotenv

load_dotenv()

from app.data_logic import clean_dataframe, generate_report_data, get_column_groups, is_system_column
from app.schemas import ProcessSheetsRequest, AnalyzeRequest, ExportDocxRequest, AiGroupRequest
from app.docx_gen import generate_analysis_docx
from app.ai_report import group_answers_openrouter
from app.auth import router as auth_router
from app.database import DB_PATH, init_db, log_upload_session, log_generated_report, cleanup_old_records, get_all_users
from app import config as cfg

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

SESSION_MAX_AGE_HOURS = 6

def _clear_old_sessions():
    now = time.time()
    for name in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, name)
        if os.path.isdir(path):
            age_hours = (now - os.path.getmtime(path)) / 3600
            if age_hours > SESSION_MAX_AGE_HOURS:
                shutil.rmtree(path, ignore_errors=True)

def _session_dir(session_id: str) -> str:
    return os.path.join(UPLOAD_DIR, session_id)

async def _session_cleanup_loop():
    while True:
        await asyncio.sleep(SESSION_MAX_AGE_HOURS * 3600)
        _clear_old_sessions()
        await cleanup_old_records(SESSION_MAX_AGE_HOURS)

@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    await cfg.load(DB_PATH)
    _clear_old_sessions()
    asyncio.create_task(_session_cleanup_loop())
    yield

app = FastAPI(title="Система аналитики опросов МГУ им. Огарева", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET_KEY", "change-me-in-production"),
    max_age=6 * 3600,
    https_only=False,
)

app.include_router(auth_router)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


@app.get("/login")
async def login_page(request: Request):
    if request.session.get("user"):
        return RedirectResponse("/")
    error = request.query_params.get("error")
    return templates.TemplateResponse(request=request, name="login.html", context={"error": error})


@app.get("/")
async def read_root(request: Request):
    user = request.session.get("user")
    if not user:
        return RedirectResponse("/login")
    settings = cfg.all_with_defaults()
    js_config = {
        "pieColors": json.loads(settings["pie_colors"]),
        "defaultFileColors": json.loads(settings["default_file_colors"]),
    }
    return templates.TemplateResponse(
        request=request, name="index.html",
        context={"title": "Аналитика опросов", "user": user, "js_config": js_config},
    )


@app.get("/users")
async def users_page(request: Request):
    user = request.session.get("user")
    if not user:
        return RedirectResponse("/login")
    users = await get_all_users()
    return templates.TemplateResponse(
        request=request, name="users.html",
        context={"user": user, "users": users},
    )


@app.get("/settings")
async def settings_page(request: Request):
    user = request.session.get("user")
    if not user:
        return RedirectResponse("/login")
    return templates.TemplateResponse(
        request=request, name="settings.html",
        context={"user": user},
    )


@app.get("/api/settings")
async def get_settings_api(request: Request):
    user = request.session.get("user")
    if not user:
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return cfg.all_with_defaults()


@app.post("/api/settings")
async def save_settings_api(request: Request):
    user = request.session.get("user")
    if not user:
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    body = await request.json()
    allowed = set(cfg.DEFAULTS.keys())
    updates = {k: str(v) for k, v in body.items() if k in allowed}
    await cfg.save_all(updates, DB_PATH)
    return {"ok": True}


@app.get("/api/settings/defaults")
async def get_settings_defaults(request: Request):
    user = request.session.get("user")
    if not user:
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return cfg.DEFAULTS

@app.post("/upload")
async def upload_files(request: Request, files: List[UploadFile] = File(...)):
    try:
        session_id = str(uuid.uuid4())
        session_path = _session_dir(session_id)
        os.makedirs(session_path, exist_ok=True)

        response_data = []
        for file in files[:cfg.get_int("max_upload_files")]:
            contents = await file.read()
            file_ext = file.filename.split('.')[-1].lower()
            safe_filename = f"raw_{os.path.basename(file.filename)}".replace(" ", "_")
            filepath = os.path.join(session_path, safe_filename)

            with open(filepath, "wb") as f:
                f.write(contents)

            if file_ext in ['csv', 'tsv']:
                sheet_names = ["CSV Данные"]
            else:
                xl = pd.ExcelFile(filepath)
                sheet_names = xl.sheet_names

            response_data.append({
                "original_name": file.filename,
                "filename": safe_filename,
                "sheets": sheet_names
            })

        user = request.session.get("user")
        await log_upload_session(
            session_id,
            user["id"] if user else None,
            [{"filename": f["filename"], "original_name": f["original_name"]} for f in response_data],
        )

        return {"files": response_data, "session_id": session_id}
    except Exception as e:
        return JSONResponse(status_code=400, content={"message": f"Ошибка загрузки файлов: {str(e)}"})

@app.post("/process_sheets")
async def process_sheets(request: ProcessSheetsRequest):
    try:
        session_path = _session_dir(request.session_id)
        if not os.path.isdir(session_path):
            return JSONResponse(status_code=400, content={"message": "Сессия не найдена. Загрузите файлы заново."})

        response_data = []
        for file_data in request.files:
            filepath = os.path.join(session_path, file_data.filename)
            if not os.path.exists(filepath):
                continue

            if file_data.filename.endswith('.csv') or file_data.filename.endswith('.tsv'):
                try: df = pd.read_csv(filepath, sep='\t')
                except Exception: df = pd.read_csv(filepath)
            else:
                dfs = []
                for sheet in file_data.sheets:
                    dfs.append(pd.read_excel(filepath, sheet_name=sheet))
                df = pd.concat(dfs, ignore_index=True)

            df_clean = clean_dataframe(df)

            clean_filename = f"clean_{file_data.filename}.parquet"
            clean_filepath = os.path.join(session_path, clean_filename)
            df_clean.to_parquet(clean_filepath, index=False)

            groups = get_column_groups(df_clean.columns)
            columns_data = [{"name": q, "is_system": is_system_column(q)} for q in groups.keys()]

            response_data.append({
                "original_name": file_data.filename.replace("raw_", ""),
                "clean_filename": clean_filename,
                "columns": columns_data
            })

        return {"processed_files": response_data}
    except Exception as e:
        return JSONResponse(status_code=400, content={"message": f"Ошибка обработки листов: {str(e)}"})

@app.post("/analyze")
async def analyze_data(request: AnalyzeRequest):
    session_path = _session_dir(request.session_id)
    if not os.path.isdir(session_path):
        return JSONResponse(status_code=400, content={"message": "Сессия не найдена. Загрузите файлы заново."})
    results = generate_report_data(session_path, request)
    return {"results": results}

@app.post("/ai_group_answers")
async def ai_group_answers(request: AiGroupRequest):
    try:
        groups = group_answers_openrouter(request.answers, request.question_name)
        return {"groups": groups}
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})

# ===================== EXPORT TASK MANAGER =====================

class ExportTask:
    """Одна задача генерации .docx, живущая в памяти процесса до часа после завершения."""

    def __init__(self, task_id: str, questions: list, session_id, user_id):
        self.task_id = task_id
        self.questions = questions
        self.session_id = session_id
        self.user_id = user_id
        self.status = "running"   # "running" | "done" | "error" | "cancelled"
        self.progress = {"current": 0, "total": len(questions), "label": ""}
        self.result_b64: str | None = None
        self.result_filename: str | None = None
        self.error: str | None = None
        self.created_at = time.time()
        self.completed_at: float | None = None
        self.cancel_event = threading.Event()
        self.subscribers: list[asyncio.Queue] = []
        self.loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()

    def _emit(self, msg: dict):
        """Атомарно обновляет внутреннее состояние и оповещает подписчиков."""
        with self._lock:
            mtype = msg.get("type")
            if mtype == "progress":
                self.progress = {
                    "current": msg["current"],
                    "total":   msg["total"],
                    "label":   msg.get("label", ""),
                }
            elif mtype == "done":
                self.status = "done"
                self.result_b64 = msg["file"]
                self.result_filename = msg["filename"]
                self.completed_at = time.time()
            elif mtype == "error":
                if self.status == "running":   
                    self.status = "error"
                    self.error = msg["message"]
                    self.completed_at = time.time()
            subs = list(self.subscribers)
        if self.loop is not None:
            for q in subs:
                try:
                    self.loop.call_soon_threadsafe(q.put_nowait, msg)
                except Exception:
                    pass

    def on_progress(self, current, total, label):
        if self.cancel_event.is_set():
            return
        self._emit({"type": "progress", "current": current, "total": total, "label": label})

    def subscribe(self):
        """Атомарно: возвращает свежий snapshot и регистрирует новую очередь.
        Любые сообщения, эмитнутые ПОСЛЕ этого вызова, попадут в очередь."""
        with self._lock:
            snap = {
                "status":   self.status,
                "progress": dict(self.progress),
                "file":     self.result_b64,
                "filename": self.result_filename,
                "error":    self.error,
            }
            queue = asyncio.Queue()
            self.subscribers.append(queue)
        return snap, queue

    def unsubscribe(self, queue):
        with self._lock:
            if queue in self.subscribers:
                self.subscribers.remove(queue)


_export_tasks: dict[str, ExportTask] = {}
_export_tasks_lock = threading.Lock()


def _cleanup_old_export_tasks(max_age_seconds: int = 3600):
    """Удалить задачи, завершённые более max_age_seconds назад."""
    now = time.time()
    with _export_tasks_lock:
        for tid in list(_export_tasks.keys()):
            t = _export_tasks[tid]
            if t.completed_at and (now - t.completed_at) > max_age_seconds:
                del _export_tasks[tid]


@app.post("/export_docx_start")
async def export_docx_start(http_request: Request, request: ExportDocxRequest):
    """Стартует фоновую задачу генерации. Возвращает task_id для подписки на стрим."""
    import base64

    questions = [q.model_dump() for q in request.questions]
    user = http_request.session.get("user")
    user_id = user["id"] if user else None

    task_id = str(uuid.uuid4())
    task = ExportTask(task_id, questions, request.session_id, user_id)
    task.loop = asyncio.get_running_loop()

    with _export_tasks_lock:
        _export_tasks[task_id] = task

    def run_generate():
        try:
            analysis_bytes = generate_analysis_docx(
                questions,
                progress_callback=task.on_progress,
                cancel_event=task.cancel_event,
            )
            if task.cancel_event.is_set():
                return
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"report_{timestamp}.docx"
            try:
                asyncio.run_coroutine_threadsafe(
                    log_generated_report(request.session_id, user_id, filename, len(questions)),
                    task.loop,
                )
            except Exception:
                pass
            file_b64 = base64.b64encode(analysis_bytes).decode()
            task._emit({"type": "done", "file": file_b64, "filename": filename})
        except Exception as e:
            task._emit({"type": "error", "message": str(e)})

    threading.Thread(target=run_generate, daemon=True).start()
    _cleanup_old_export_tasks()

    return {"task_id": task_id}


@app.get("/export_docx_stream/{task_id}")
async def export_docx_stream(task_id: str):
    """SSE-подписка на задачу. Клиент получает текущий snapshot и далее live-обновления.
    Можно подключаться/отключаться сколько угодно раз — задача от этого не зависит."""
    with _export_tasks_lock:
        task = _export_tasks.get(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"message": "Задача не найдена или истекла"})

    snap, queue = task.subscribe()

    async def event_generator():
        try:
            if snap["progress"]["current"] > 0:
                yield f"data: {json.dumps({'type': 'progress', **snap['progress']}, ensure_ascii=False)}\n\n"

            if snap["status"] == "done":
                yield f"data: {json.dumps({'type': 'done', 'file': snap['file'], 'filename': snap['filename']}, ensure_ascii=False)}\n\n"
                return
            if snap["status"] in ("error", "cancelled"):
                yield f"data: {json.dumps({'type': 'error', 'message': snap['error'] or 'Задача отменена'}, ensure_ascii=False)}\n\n"
                return

            while True:
                msg = await queue.get()
                yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
                if msg.get("type") in ("done", "error"):
                    break
        finally:
            task.unsubscribe(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/export_docx_cancel/{task_id}")
async def export_docx_cancel(task_id: str):
    """Запросить отмену задачи. cancel_event проверяется внутри генератора между шагами."""
    with _export_tasks_lock:
        task = _export_tasks.get(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"message": "Задача не найдена"})
    task.cancel_event.set()
    task._emit({"type": "error", "message": "Генерация отменена пользователем"})
    return {"ok": True}
