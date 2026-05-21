import io
import time
import random
from openai import OpenAI
from docx import Document
from docx.shared import Pt, Cm
from app.chart_gen import insert_visualization
from app import config as cfg


# ===================== SINGLETON КЛИЕНТ И PACING =====================

_openrouter_client: OpenAI | None = None
_openrouter_client_key: str = ""
_LAST_REQUEST_TIME: float = 0.0


def get_openrouter_client() -> OpenAI:
    """Один TCP-клиент на всё приложение. Пересоздаётся, если ключ изменился через настройки."""
    global _openrouter_client, _openrouter_client_key
    key = cfg.get("openrouter_api_key")
    if not key:
        raise ValueError("OPENROUTER_API_KEY не задан (проверьте .env или Настройки)")
    if _openrouter_client is None or _openrouter_client_key != key:
        _openrouter_client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=key,
            timeout=cfg.get_float("llm_request_timeout"),
        )
        _openrouter_client_key = key
    return _openrouter_client


def _pace():
    """Адаптивная пауза: ждём только если с прошлого запроса прошло меньше min_interval."""
    global _LAST_REQUEST_TIME
    min_interval = cfg.get_float("llm_sleep_between_calls")
    delta = time.time() - _LAST_REQUEST_TIME
    if delta < min_interval:
        time.sleep(min_interval - delta)


def _mark_request_done():
    global _LAST_REQUEST_TIME
    _LAST_REQUEST_TIME = time.time()


def _backoff_wait(attempt: int):
    """Экспоненциальный backoff с jitter: 2/4/8/16/32с (capped at 60) + random 0.5..2."""
    wait = min(60.0, (2 ** (attempt + 1)) + random.uniform(0.5, 2.0))
    print(f"  -> Rate limit (попытка {attempt + 1}), жду {wait:.1f}с...")
    time.sleep(wait)


# ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================

def _p(doc, text, bold=False, size=12, space_before=0, space_after=3):
    para = doc.add_paragraph()
    para.paragraph_format.space_before = Pt(space_before)
    para.paragraph_format.space_after = Pt(space_after)
    run = para.add_run(text)
    run.bold = bold
    run.font.name = "Times New Roman"
    run.font.size = Pt(size)
    return para


def _make_doc():
    doc = Document()
    for section in doc.sections:
        section.top_margin = Cm(2)
        section.bottom_margin = Cm(2)
        section.left_margin = Cm(3)
        section.right_margin = Cm(1.5)
    doc.styles["Normal"].font.name = "Times New Roman"
    doc.styles["Normal"].font.size = Pt(12)
    return doc


# ===================== ДАННЫЕ (файл 1) =====================

def generate_data_docx(questions: list) -> bytes:
    """Файл со списками вопросов и статистикой без аналитики."""
    doc = _make_doc()
    _last_section = None

    for q in questions:
        sec = q.get("section")
        sec_name = sec.get("name") if sec else None

        if sec_name and sec_name != _last_section:
            _last_section = sec_name
            if doc.paragraphs:
                doc.add_page_break()
            _p(doc, sec_name, bold=True, size=14, space_after=4)
            if sec.get("description"):
                _p(doc, sec["description"], size=12, space_after=8)

        file_keys = q["file_keys"]
        file_labels = q["file_labels"]
        file_totals = q["file_totals"]
        is_single = len(file_keys) == 1

        _p(doc, f"Вопрос {q['table_num']} – «{q['question_name']}»",
           bold=True, space_before=10, space_after=2)

        for row in q["rows"]:
            if is_single:
                fk = file_keys[0]
                count = row["counts"].get(fk, 0)
                total = file_totals.get(fk, 0)
                pct = f"{count / total * 100:.1f}%" if total > 0 else "—"
                _p(doc, f"  • {row['answer']}: {count} ({pct})", space_after=1)
            else:
                parts = []
                for fk in file_keys:
                    label = file_labels.get(fk, fk)
                    count = row["counts"].get(fk, 0)
                    total = file_totals.get(fk, 0)
                    pct = f"{count / total * 100:.1f}%" if total > 0 else "—"
                    parts.append(f"{label}: {count} ({pct})")
                _p(doc, f"  • {row['answer']}: {'; '.join(parts)}", space_after=1)

        if q.get("show_total", True):
            if is_single:
                fk = file_keys[0]
                _p(doc, f"  Всего: {file_totals.get(fk, 0)}", bold=True, space_after=6)
            else:
                parts = [
                    f"{file_labels.get(fk, fk)}: {file_totals.get(fk, 0)}"
                    for fk in file_keys
                ]
                _p(doc, f"  Всего: {'; '.join(parts)}", bold=True, space_after=6)

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.getvalue()


# ===================== ПРОМПТЫ =====================

def _build_question_prompt(
    question: dict,
    sec_name: str = "",
    sec_description: str = "",
) -> tuple[str, str]:

    # ── SYSTEM ──────────────────────────────────────────────────────────
    system_parts = cfg.get("prompt_system_role").splitlines()

    if sec_description:
        system_parts += [
            "",
            "## Контекст текущего раздела",
            sec_description,
            "",
            "Используй этот контекст при написании анализа:",
            "— Если здесь сформулировано конкретное требование или акцент — строго следуй ему.",
            "— Если это описание тематики или состава раздела — учитывай при интерпретации.",
            "— Если это пояснение или замечание — прими во внимание как фоновый контекст.",
            "Академический стиль — инструмент, он не должен вступать в противоречие с контекстом раздела.",
        ]

    system_prompt = "\n".join(system_parts)

    # ── USER ─────────────────────────────────────────────────────────────
    lines = [
        "Ниже — примеры желаемого стиля:",
        cfg.get("prompt_style_example"),
        "",
        "ПРАВИЛА НАПИСАНИЯ:",
        cfg.get("prompt_writing_rules"),
        "",
    ]

    if sec_name:
        lines += [f"Раздел анкеты: «{sec_name}»", ""]

    q = question
    lines += [
        f"Напиши аналитический фрагмент по вопросу: «{q['question_name']}»",
        "",
        "Статистика ответов:",
    ]
    for row in q["rows"]:
        parts = []
        for fk in q["file_keys"]:
            label = q["file_labels"].get(fk, fk)
            count = row["counts"].get(fk, 0)
            total = q["file_totals"].get(fk, 0)
            pct = round(count / total * 100, 1) if total > 0 else 0
            parts.append(f"{label}: {count} ({pct}%)")
        lines.append(f"  - {row['answer']}: {'; '.join(parts)}")

    if sec_description:
        lines += [
            "",
            "При написании учти контекст раздела, указанный в начале.",
        ]

    user_prompt = "\n".join(lines)
    return system_prompt, user_prompt


# ===================== ВЫЗОВ МОДЕЛИ =====================

def _call_llm(prompt: str, system: str = "") -> str:
    client = get_openrouter_client()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    _pace()
    for attempt in range(6):
        try:
            response = client.chat.completions.create(
                model=cfg.get("openrouter_model"),
                messages=messages,
                max_tokens=cfg.get_int("llm_max_tokens_analysis"),
                temperature=cfg.get_float("llm_temperature"),
            )
            _mark_request_done()
            return response.choices[0].message.content.strip()
        except Exception as e:
            if "429" in str(e) and attempt < 5:
                _backoff_wait(attempt)
            else:
                raise


# ===================== АНАЛИТИКА (файл 2) =====================

def generate_analysis_docx(questions: list, progress_callback=None, cancel_event=None) -> bytes:
    """Аналитический файл: один вызов LLM на каждый вопрос."""
    doc = _make_doc()
    total_questions = len(questions)
    _last_section = None
    chart_counter = [1]

    for idx, q in enumerate(questions, start=1):
        if cancel_event and cancel_event.is_set():
            break

        sec = q.get("section")
        sec_name = sec.get("name") if sec else ""
        sec_description = sec.get("description", "") if sec else ""

        if progress_callback:
            progress_callback(idx, total_questions, q["question_name"])

        print(f"[{idx}/{total_questions}] Генерация: {q['question_name']}")

        if sec_name and sec_name != _last_section:
            _last_section = sec_name
            if idx > 1:
                doc.add_page_break()
            _p(doc, sec_name, bold=True, size=14, space_after=4)
            if sec_description:
                _p(doc, sec_description, size=11, space_after=6)

        _p(
            doc,
            f"Вопрос {q['table_num']} — «{q['question_name']}»",
            bold=True,
            size=12,
            space_before=8,
            space_after=3,
        )

        try:
            system_prompt, user_prompt = _build_question_prompt(q, sec_name, sec_description)
            analysis = _call_llm(user_prompt, system=system_prompt)
            _p(doc, analysis, space_after=6)
            print("  -> OK")
        except Exception as e:
            print(f"  -> ERROR: {e}")
            _p(doc, f"Ошибка генерации аналитики: {e}", bold=True, space_after=4)

        insert_visualization(doc, q, chart_counter)

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.getvalue()


# ===================== ЕДИНАЯ ТОЧКА ВХОДА =====================

def generate_docx(questions: list, progress_callback=None) -> tuple[bytes, bytes]:
    data_bytes = generate_data_docx(questions)
    analysis_bytes = generate_analysis_docx(questions, progress_callback=progress_callback)
    return data_bytes, analysis_bytes
