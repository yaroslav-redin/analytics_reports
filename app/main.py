# ===================== main.py =====================
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

@asynccontextmanager
async def lifespan(_: FastAPI):
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
    return templates.TemplateResponse(
        request=request, name="index.html",
        context={"title": "Аналитика опросов", "user": user},
    )

@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    try:
        session_id = str(uuid.uuid4())
        session_path = _session_dir(session_id)
        os.makedirs(session_path, exist_ok=True)

        response_data = []
        for file in files[:10]:
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

@app.post("/export_docx_stream")
async def export_docx_stream(request: ExportDocxRequest):
    import base64
    questions = [q.model_dump() for q in request.questions]

    async def event_generator():
        loop = asyncio.get_event_loop()
        queue = asyncio.Queue()
        cancel_event = threading.Event()

        def progress_cb(current, total, label):
            if cancel_event.is_set():
                return
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"type": "progress", "current": current, "total": total, "label": label}
            )

        def run_generate():
            try:
                analysis_bytes = generate_analysis_docx(
                    questions,
                    progress_callback=progress_cb,
                    cancel_event=cancel_event,
                )
                if cancel_event.is_set():
                    return
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"report_{timestamp}.docx"
                loop.call_soon_threadsafe(queue.put_nowait, {
                    "type": "done",
                    "file": base64.b64encode(analysis_bytes).decode(),
                    "filename": filename
                })
            except Exception as e:
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(e)})

        threading.Thread(target=run_generate, daemon=True).start()

        try:
            while True:
                msg = await queue.get()
                yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
                if msg["type"] in ("done", "error"):
                    break
        finally:
            cancel_event.set()

    return StreamingResponse(event_generator(), media_type="text/event-stream")
