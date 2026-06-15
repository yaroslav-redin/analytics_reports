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
import logging
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

_logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)

load_dotenv()

from app.data_logic import clean_dataframe, generate_report_data, get_column_groups, is_system_column
from app.schemas import ProcessSheetsRequest, AnalyzeRequest, ExportDocxRequest, AiGroupRequest
from app.docx_gen import generate_analysis_docx
from app.ai_report import group_answers_openrouter
from app.auth import router as auth_router
from app.database import (
    DB_PATH, init_db, log_upload_session, log_generated_report,
    cleanup_old_records, get_all_users, pop_user_sessions,
    set_user_admin, set_user_banned,
)
from app import config as cfg

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

SESSION_MAX_AGE_HOURS = 6
_ALLOWED_EXTENSIONS = frozenset({'csv', 'tsv', 'xls', 'xlsx'})
_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 МБ на файл

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
    await cleanup_old_records(SESSION_MAX_AGE_HOURS)
    asyncio.create_task(_session_cleanup_loop())
    yield

_PUBLIC_PATHS = {"/login", "/auth/login", "/auth/logout", "/signin-eios", "/auth/me"}
_PAGE_PATHS = {"/", "/users", "/settings"}


class AuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        path = scope["path"]
        if path in _PUBLIC_PATHS or path.startswith("/static/"):
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        if not request.session.get("user"):
            is_page = path in _PAGE_PATHS and scope.get("method", "GET") == "GET"
            if is_page:
                response = RedirectResponse("/login")
            else:
                response = JSONResponse(status_code=401, content={"detail": "Not authenticated"})
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


_session_secret = os.getenv("SESSION_SECRET_KEY")
if not _session_secret:
    raise RuntimeError("SESSION_SECRET_KEY не задан в .env")

app = FastAPI(title="Система аналитики опросов МГУ им. Огарева", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(AuthMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=_session_secret,
    max_age=6 * 3600,
    https_only=os.getenv("HTTPS_ONLY", "false").lower() == "true",
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
    settings = cfg.all_with_defaults()
    js_config = {
        "pieColors": json.loads(settings["pie_colors"]),
        "defaultFileColors": json.loads(settings["default_file_colors"]),
    }
    return templates.TemplateResponse(
        request=request, name="index.html",
        context={"title": "Аналитика опросов", "user": user, "js_config": js_config},
    )


def _is_admin(request: Request) -> bool:
    return bool((request.session.get("user") or {}).get("is_admin"))


@app.get("/users")
async def users_page(request: Request):
    if not _is_admin(request):
        return RedirectResponse("/")
    user = request.session.get("user")
    users = await get_all_users()
    return templates.TemplateResponse(
        request=request, name="users.html",
        context={"user": user, "users": users},
    )


@app.get("/settings")
async def settings_page(request: Request):
    if not _is_admin(request):
        return RedirectResponse("/")
    user = request.session.get("user")
    return templates.TemplateResponse(
        request=request, name="settings.html",
        context={"user": user},
    )


_REDACTED_SETTINGS = {"openrouter_api_key"}

@app.get("/api/settings")
async def get_settings_api(request: Request):
    if not _is_admin(request):
        return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    data = cfg.all_with_defaults()
    for k in _REDACTED_SETTINGS:
        if k in data and data[k]:
            data[k] = "***"
    return data


@app.post("/api/settings")
@limiter.limit("20/minute")
async def save_settings_api(request: Request):
    if not _is_admin(request):
        return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    body = await request.json()
    allowed = set(cfg.DEFAULTS.keys())
    updates = {k: str(v) for k, v in body.items() if k in allowed}
    await cfg.save_all(updates, DB_PATH)
    return {"ok": True}


@app.post("/api/users/{user_id}/set_admin")
@limiter.limit("20/minute")
async def api_set_admin(user_id: str, request: Request):
    if not _is_admin(request):
        return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    current_user = request.session["user"]
    if user_id == current_user["id"]:
        return JSONResponse(status_code=400, content={"detail": "Нельзя изменить свой статус администратора"})
    body = await request.json()
    await set_user_admin(user_id, bool(body.get("is_admin")))
    return {"ok": True}


@app.post("/api/users/{user_id}/set_banned")
@limiter.limit("20/minute")
async def api_set_banned(user_id: str, request: Request):
    if not _is_admin(request):
        return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    current_user = request.session["user"]
    if user_id == current_user["id"]:
        return JSONResponse(status_code=400, content={"detail": "Нельзя заблокировать себя"})
    body = await request.json()
    await set_user_banned(user_id, bool(body.get("is_banned")))
    return {"ok": True}


@app.get("/api/settings/defaults")
async def get_settings_defaults(request: Request):
    user = request.session.get("user")
    if not user:
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return cfg.DEFAULTS

def _write_session_owner(session_id: str, user_id: str):
    owner_file = os.path.join(_session_dir(session_id), "_owner")
    with open(owner_file, "w", encoding="utf-8") as f:
        f.write(user_id)


def _read_session_owner(session_id: str) -> str | None:
    owner_file = os.path.join(_session_dir(session_id), "_owner")
    try:
        with open(owner_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def _check_session_owner(session_id: str, user_id: str | None) -> bool:
    """Возвращает True только если user_id владеет сессией и session_id — валидный UUID."""
    if not user_id:
        return False
    try:
        uuid.UUID(session_id)
    except ValueError:
        return False
    return _read_session_owner(session_id) == user_id


def _rmtree_force(path: str):
    """shutil.rmtree с принудительным снятием readonly и повтором при EBUSY."""
    import stat as _stat

    def _on_exc(func, fpath, _exc):
        try:
            os.chmod(fpath, _stat.S_IWRITE)
            func(fpath)
        except OSError:
            pass

    for attempt in range(3):
        try:
            shutil.rmtree(path, onexc=_on_exc)
            return
        except OSError:
            if attempt < 2:
                time.sleep(0.3)
    shutil.rmtree(path, ignore_errors=True)


def _cleanup_user_sessions(user_id: str, exclude_session_id: str):
    """Удаляет все папки сессий пользователя, кроме exclude_session_id."""
    if not os.path.isdir(UPLOAD_DIR):
        return
    for name in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, name)
        if not os.path.isdir(path) or name == exclude_session_id:
            continue
        if _read_session_owner(name) == user_id:
            _rmtree_force(path)


@app.post("/upload")
@limiter.limit("10/minute")
async def upload_files(request: Request, files: List[UploadFile] = File(...)):
    try:
        user = request.session.get("user")
        user_id = user["id"]

        session_id = str(uuid.uuid4())
        session_path = _session_dir(session_id)
        os.makedirs(session_path, exist_ok=True)
        _write_session_owner(session_id, user_id)

        _cleanup_user_sessions(user_id, exclude_session_id=session_id)
        await pop_user_sessions(user_id)

        response_data = []
        for file in files[:cfg.get_int("max_upload_files")]:
            original_name = file.filename or ""
            file_ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else ''
            if file_ext not in _ALLOWED_EXTENSIONS:
                return JSONResponse(status_code=400, content={
                    "message": f"Недопустимый тип файла «{original_name}». Разрешены: xlsx, xls, csv, tsv."
                })

            contents = await file.read()
            if len(contents) > _MAX_FILE_SIZE_BYTES:
                return JSONResponse(status_code=400, content={
                    "message": f"Файл «{original_name}» превышает допустимый размер 50 МБ."
                })

            safe_name = os.path.basename(original_name).replace(" ", "_")
            safe_filename = f"raw_{safe_name}"
            filepath = os.path.join(session_path, safe_filename)

            with open(filepath, "wb") as f:
                f.write(contents)

            if file_ext in ('csv', 'tsv'):
                sheet_names = ["CSV Данные"]
            else:
                with pd.ExcelFile(filepath) as xl:
                    sheet_names = xl.sheet_names

            response_data.append({
                "original_name": original_name,
                "filename": safe_filename,
                "sheets": sheet_names
            })

        await log_upload_session(
            session_id,
            user_id,
            [{"filename": f["filename"], "original_name": f["original_name"]} for f in response_data],
        )

        return {"files": response_data, "session_id": session_id}
    except Exception:
        _logger.exception("Ошибка загрузки файлов user=%s", request.session.get("user", {}).get("id"))
        return JSONResponse(status_code=400, content={"message": "Ошибка загрузки файлов. Проверьте формат и повторите."})

@app.post("/process_sheets")
@limiter.limit("30/minute")
async def process_sheets(request: Request, body: ProcessSheetsRequest):
    user = request.session.get("user")
    user_id = user["id"] if user else None
    if not _check_session_owner(body.session_id, user_id):
        return JSONResponse(status_code=403, content={"message": "Доступ запрещён"})

    try:
        session_path = _session_dir(body.session_id)
        session_path_real = os.path.realpath(session_path)

        response_data = []
        for file_data in body.files:
            safe_name = os.path.basename(file_data.filename)
            filepath = os.path.join(session_path, safe_name)
            # Path traversal guard
            if not os.path.realpath(filepath).startswith(session_path_real + os.sep):
                continue
            if not os.path.exists(filepath):
                continue

            if safe_name.endswith('.csv') or safe_name.endswith('.tsv'):
                try: df = pd.read_csv(filepath, sep='\t')
                except Exception: df = pd.read_csv(filepath)
            else:
                dfs = []
                for sheet in file_data.sheets:
                    dfs.append(pd.read_excel(filepath, sheet_name=sheet))
                df = pd.concat(dfs, ignore_index=True)

            _MAX_ROWS = 100_000
            if len(df) > _MAX_ROWS:
                return JSONResponse(status_code=400, content={
                    "message": f"Файл «{safe_name}» содержит более {_MAX_ROWS:,} строк. Пожалуйста, уменьшите размер выборки."
                })

            df_clean = clean_dataframe(df)

            clean_filename = f"clean_{safe_name}.parquet"
            clean_filepath = os.path.join(session_path, clean_filename)
            df_clean.to_parquet(clean_filepath, index=False)

            groups = get_column_groups(df_clean.columns, df_clean)
            columns_data = [{"name": q, "is_system": is_system_column(q)} for q in groups.keys()]

            response_data.append({
                "original_name": safe_name.replace("raw_", "", 1),
                "clean_filename": clean_filename,
                "columns": columns_data
            })

        return {"processed_files": response_data}
    except Exception:
        _logger.exception("Ошибка обработки листов session=%s user=%s", body.session_id, user_id)
        return JSONResponse(status_code=400, content={"message": "Ошибка обработки листов. Проверьте формат файла."})

@app.post("/analyze")
@limiter.limit("30/minute")
async def analyze_data(request: Request, body: AnalyzeRequest):
    user = request.session.get("user")
    user_id = user["id"] if user else None
    if not _check_session_owner(body.session_id, user_id):
        return JSONResponse(status_code=403, content={"message": "Доступ запрещён"})

    session_path = _session_dir(body.session_id)
    try:
        results = generate_report_data(session_path, body)
        return {"results": results}
    except Exception:
        _logger.exception("Ошибка анализа session=%s user=%s", body.session_id, user_id)
        return JSONResponse(status_code=500, content={"message": "Ошибка анализа данных."})

@app.post("/ai_group_answers")
@limiter.limit("30/minute")
async def ai_group_answers(request: Request, body: AiGroupRequest):
    try:
        groups = group_answers_openrouter(body.answers, body.question_name)
        return {"groups": groups}
    except Exception:
        _logger.exception("Ошибка ai_group_answers")
        return JSONResponse(status_code=500, content={"message": "Ошибка группировки ответов."})


# ===================== AI GROUP TASK MANAGER =====================

class AiGroupTask:
    """Фоновая задача ИИ-группировки ответов с поддержкой отмены."""

    def __init__(self, task_id: str, user_id: str):
        self.task_id = task_id
        self.user_id = user_id
        self.cancel_event = threading.Event()
        self.status = "running"   # "done" | "error" | "cancelled"
        self.result: list | None = None
        self.error: str | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self._asyncio_done: asyncio.Event | None = None
        self._lock = threading.Lock()

    def _finish(self, status: str, result=None, error: str | None = None):
        with self._lock:
            if self.status != "running":
                return
            self.status = status
            self.result = result
            self.error = error
        if self.loop and self._asyncio_done:
            self.loop.call_soon_threadsafe(self._asyncio_done.set)


_ai_group_tasks: dict[str, AiGroupTask] = {}
_ai_group_tasks_lock = threading.Lock()


def _cleanup_old_ai_group_tasks(max_age_seconds: int = 600):
    now = time.time()
    with _ai_group_tasks_lock:
        for tid in list(_ai_group_tasks.keys()):
            t = _ai_group_tasks[tid]
            if t.status != "running" and t._asyncio_done and t._asyncio_done.is_set():
                if now - (getattr(t, "_finished_at", now)) > max_age_seconds:
                    del _ai_group_tasks[tid]


@app.post("/ai_group_start")
@limiter.limit("30/minute")
async def ai_group_start(request: Request, body: AiGroupRequest):
    """Запускает фоновую ИИ-группировку и сразу возвращает task_id."""
    user = request.session.get("user")
    user_id = user["id"] if user else None

    task_id = str(uuid.uuid4())
    task = AiGroupTask(task_id, user_id)
    task.loop = asyncio.get_running_loop()
    task._asyncio_done = asyncio.Event()

    with _ai_group_tasks_lock:
        _ai_group_tasks[task_id] = task

    answers = body.answers
    question_name = body.question_name

    def run_group():
        try:
            groups = group_answers_openrouter(answers, question_name, cancel_event=task.cancel_event)
            if task.cancel_event.is_set():
                task._finish("cancelled", error="Группировка отменена пользователем")
            else:
                task._finish("done", result=groups)
        except Exception:
            _logger.exception("Ошибка ai_group task=%s user=%s", task_id, user_id)
            task._finish("error", error="Ошибка группировки ответов.")

    threading.Thread(target=run_group, daemon=True).start()
    _cleanup_old_ai_group_tasks()
    return {"task_id": task_id}


@app.get("/ai_group_result/{task_id}")
async def ai_group_result(task_id: str, request: Request):
    """Long-poll: ждёт завершения задачи и возвращает результат или ошибку."""
    with _ai_group_tasks_lock:
        task = _ai_group_tasks.get(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"message": "Задача не найдена"})
    user = request.session.get("user")
    user_id = user["id"] if user else None
    if task.user_id != user_id:
        return JSONResponse(status_code=403, content={"message": "Доступ запрещён"})

    try:
        await asyncio.wait_for(task._asyncio_done.wait(), timeout=900)
    except asyncio.TimeoutError:
        return JSONResponse(status_code=408, content={"message": "Превышено время ожидания группировки"})

    if task.status == "done":
        return {"groups": task.result}
    return JSONResponse(status_code=500, content={"message": task.error or "Ошибка группировки"})


@app.post("/ai_group_cancel/{task_id}")
async def ai_group_cancel(task_id: str, request: Request):
    """Запрашивает отмену задачи ИИ-группировки."""
    with _ai_group_tasks_lock:
        task = _ai_group_tasks.get(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"message": "Задача не найдена"})
    user = request.session.get("user")
    user_id = user["id"] if user else None
    if task.user_id != user_id:
        return JSONResponse(status_code=403, content={"message": "Доступ запрещён"})
    task.cancel_event.set()
    task._finish("cancelled", error="Группировка отменена пользователем")
    return {"ok": True}


# ===================== EXPORT TASK MANAGER =====================

class ExportTask:
    """Одна задача генерации .docx, живущая в памяти процесса до часа после завершения."""

    def __init__(self, task_id: str, questions: list, session_id, user_id,
                 title_page_body=None, title_page_approval=None):
        self.task_id = task_id
        self.questions = questions
        self.session_id = session_id
        self.user_id = user_id
        self.title_page_body = title_page_body
        self.title_page_approval = title_page_approval
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
@limiter.limit("5/minute")
async def export_docx_start(request: Request, body: ExportDocxRequest):
    """Стартует фоновую задачу генерации. Возвращает task_id для подписки на стрим."""
    import base64

    user = request.session.get("user")
    user_id = user["id"] if user else None

    if body.session_id and not _check_session_owner(body.session_id, user_id):
        return JSONResponse(status_code=403, content={"message": "Доступ запрещён"})

    # Лимит: не более 2 активных задач на пользователя
    _MAX_EXPORTS_PER_USER = 2
    with _export_tasks_lock:
        active_for_user = sum(
            1 for t in _export_tasks.values()
            if t.user_id == user_id and t.status == "running"
        )
    if active_for_user >= _MAX_EXPORTS_PER_USER:
        return JSONResponse(status_code=429, content={
            "message": "Достигнут лимит одновременных задач генерации. Дождитесь завершения текущей."
        })

    questions = [q.model_dump() for q in body.questions]

    task_id = str(uuid.uuid4())
    task = ExportTask(task_id, questions, body.session_id, user_id,
                      title_page_body=body.title_page_body,
                      title_page_approval=body.title_page_approval)
    task.loop = asyncio.get_running_loop()

    with _export_tasks_lock:
        _export_tasks[task_id] = task

    def run_generate():
        try:
            analysis_bytes = generate_analysis_docx(
                questions,
                progress_callback=task.on_progress,
                cancel_event=task.cancel_event,
                title_page_body=task.title_page_body,
                title_page_approval=task.title_page_approval,
            )
            if task.cancel_event.is_set():
                return
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"report_{timestamp}.docx"
            try:
                asyncio.run_coroutine_threadsafe(
                    log_generated_report(task.session_id, user_id, filename, len(questions)),
                    task.loop,
                )
            except Exception:
                pass
            file_b64 = base64.b64encode(analysis_bytes).decode()
            task._emit({"type": "done", "file": file_b64, "filename": filename})
        except Exception:
            _logger.exception("Ошибка генерации docx task=%s user=%s", task_id, user_id)
            task._emit({"type": "error", "message": "Ошибка генерации отчёта. Попробуйте ещё раз."})

    threading.Thread(target=run_generate, daemon=True).start()
    _cleanup_old_export_tasks()

    return {"task_id": task_id}


@app.get("/export_docx_stream/{task_id}")
async def export_docx_stream(task_id: str, request: Request):
    """SSE-подписка на задачу. Клиент получает текущий snapshot и далее live-обновления.
    Можно подключаться/отключаться сколько угодно раз — задача от этого не зависит."""
    with _export_tasks_lock:
        task = _export_tasks.get(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"message": "Задача не найдена или истекла"})
    user = request.session.get("user")
    user_id = user["id"] if user else None
    if task.user_id != user_id:
        return JSONResponse(status_code=403, content={"message": "Доступ запрещён"})

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
async def export_docx_cancel(task_id: str, request: Request):
    """Запросить отмену задачи. cancel_event проверяется внутри генератора между шагами."""
    with _export_tasks_lock:
        task = _export_tasks.get(task_id)
    if task is None:
        return JSONResponse(status_code=404, content={"message": "Задача не найдена"})
    user = request.session.get("user")
    user_id = user["id"] if user else None
    if task.user_id != user_id:
        return JSONResponse(status_code=403, content={"message": "Доступ запрещён"})
    task.cancel_event.set()
    task._emit({"type": "error", "message": "Генерация отменена пользователем"})
    return {"ok": True}
