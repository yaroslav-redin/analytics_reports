"""Преобразование отчётов ЭИОС в «виртуальные файлы» мастера.

Каждая когорта сохраняется как uploads/{session_id}/eios_cohort_{i}.json
с готовыми счётчиками {вопрос: {ответ: количество}} — /analyze читает их
вместо Parquet, остальной конвейер не меняется. Вопросы типа «порядок»
хранятся отдельно — {вопрос: {вариант: средний ранг}}.
"""
import json
import os
from collections import Counter

from app.schemas import EiosCohort, EiosCohortFilters
from app.text_utils import strip_html

COHORT_FILE_PREFIX = "eios_cohort_"

# 0 — один вариант, 1 — несколько, 4 — свой текст, 10 — звёзды: Items — количества.
# 2 — порядок: Count — средний порядковый номер варианта, идёт в ranks, а не в счётчики.
# 3 (соответствие: нет Items) не поддерживается.
RANK_QUESTION_TYPE = 2
COUNT_QUESTION_TYPES = {0, 1, 4, 10}
SUPPORTED_QUESTION_TYPES = COUNT_QUESTION_TYPES | {RANK_QUESTION_TYPE}
ABSTAIN_TEXT = "Воздержались от ответа"
_STAT_KEYS = ("SessionsCount", "AudienceSize", "AnsweredCount", "CoveragePercent")
_TEACHER_ONLY_FIELDS = ("IsPps", "Department")


class EiosNoData(Exception):
    pass


def clean_metadata(meta: dict) -> dict:
    """Убирает HTML-разметку из текстов вопросов и вариантов справочника (на месте)."""
    for q in meta.get("Questions") or []:
        q["Text"] = strip_html(q.get("Text"))
        for a in q.get("Answers") or []:
            a["Text"] = strip_html(a.get("Text"))
    return meta


def _question_text(q: dict) -> str:
    return strip_html(q.get("Text") or "").strip() or f"Вопрос {q['QuestionId']}"


def build_question_names(questions: list[dict]) -> tuple[dict[int, str], list[dict]]:
    """QuestionId → уникальное имя колонки (в порядке анкеты) и список пропущенных вопросов."""
    supported = [q for q in questions if q.get("QuestionType") in SUPPORTED_QUESTION_TYPES]
    text_counts = Counter(_question_text(q) for q in supported)
    names: dict[int, str] = {}
    skipped: list[dict] = []
    for q in questions:
        text = _question_text(q)
        if q.get("QuestionType") not in SUPPORTED_QUESTION_TYPES:
            skipped.append({"id": q["QuestionId"], "text": text, "type_name": q.get("QuestionTypeName", "")})
            continue
        names[q["QuestionId"]] = f"{text} [{q['QuestionId']}]" if text_counts[text] > 1 else text
    return names, skipped


def _item_text(item: dict) -> str:
    text = strip_html(str(item.get("Text") or "")).strip()
    return "" if text == ABSTAIN_TEXT else text


def report_to_counts(report: dict, names: dict[int, str]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for detail in report.get("Details") or []:
        name = names.get(detail.get("QuestionId"))
        if name is None or detail.get("QuestionType") == RANK_QUESTION_TYPE:
            continue
        counts: dict[str, int] = {}
        for item in detail.get("Items") or []:
            text = _item_text(item)
            cnt = int(round(float(item.get("Count") or 0)))
            if not text or cnt <= 0:
                continue
            counts[text] = counts.get(text, 0) + cnt
        if counts:
            out[name] = counts
    return out


def report_to_ranks(report: dict, names: dict[int, str]) -> dict[str, dict[str, float]]:
    """Вопросы типа «порядок»: {вопрос: {вариант: средний ранг}}; 0 — варианту порядок не назначали."""
    out: dict[str, dict[str, float]] = {}
    for detail in report.get("Details") or []:
        name = names.get(detail.get("QuestionId"))
        if name is None or detail.get("QuestionType") != RANK_QUESTION_TYPE:
            continue
        ranks: dict[str, float] = {}
        for item in detail.get("Items") or []:
            text = _item_text(item)
            rank = float(item.get("Count") or 0)
            if text and rank > 0:
                ranks[text] = round(rank, 2)
        if ranks:
            out[name] = ranks
    return out


def _condition_body(condition) -> dict:
    return {k: v for k, v in condition.model_dump(exclude_none=True).items() if v != []}


def build_report_request(profile_id: int, filters: EiosCohortFilters) -> dict:
    body = {"TestProfileId": profile_id}
    body.update(filters.model_dump(exclude={"Conditions"}, exclude_none=True))
    if filters.Audience != 2:
        # IsPps / Department / AcademicDegrees имеют смысл только для аудитории 2.
        for key in _TEACHER_ONLY_FIELDS:
            body.pop(key, None)
        body["AcademicDegrees"] = []
    body["Conditions"] = [_condition_body(c) for c in filters.Conditions]
    return body


def is_eios_cohort_file(name: str) -> bool:
    return name.startswith(COHORT_FILE_PREFIX) and name.endswith(".json")


def load_cohort(filepath: str) -> tuple[dict[str, dict[str, int]], dict[str, dict[str, float]]]:
    """Счётчики и средние ранги когорты."""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("counts", {}), data.get("ranks", {})


def write_eios_session(
    session_path: str, metas: dict[int, dict], cohort_reports: list[tuple[EiosCohort, dict]],
) -> tuple[list[dict], list[dict]]:
    """metas — справочники опросов по profile_id; у каждой когорты колонки своего опроса."""
    names_by_profile: dict[int, dict[int, str]] = {}
    skipped: list[dict] = []
    for cohort, _ in cohort_reports:
        pid = cohort.profile_id
        if pid in names_by_profile:
            continue
        meta = metas[pid]
        names_by_profile[pid], survey_skipped = build_question_names(meta.get("Questions") or [])
        title = meta.get("Title") or f"Опрос {pid}"
        skipped.extend({**s, "survey": title} for s in survey_skipped)

    per_cohort = []
    for c, r in cohort_reports:
        names = names_by_profile[c.profile_id]
        per_cohort.append((c, r, report_to_counts(r, names), report_to_ranks(r, names)))

    # Колонки опроса — вопросы с данными хотя бы в одной когорте этого же опроса, в порядке анкеты.
    ordered_by_profile: dict[int, list[str]] = {}
    for pid, names in names_by_profile.items():
        with_data = {name for c, _, counts, ranks in per_cohort if c.profile_id == pid
                     for name in (*counts, *ranks)}
        ordered_by_profile[pid] = [name for name in names.values() if name in with_data]
    if not any(ordered_by_profile.values()):
        raise EiosNoData("Ни одна анкета не попала в выборку. Ослабьте фильтры или выберите другой опрос.")

    processed = []
    for i, (cohort, report, counts, ranks) in enumerate(per_cohort):
        filename = f"{COHORT_FILE_PREFIX}{i}.json"
        stats = {k: report.get(k) for k in _STAT_KEYS}
        payload = {
            "label": cohort.label,
            "profile_id": cohort.profile_id,
            "filters": cohort.filters.model_dump(),
            "stats": stats,
            "counts": counts,
            "ranks": ranks,
        }
        with open(os.path.join(session_path, filename), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        processed.append({
            "original_name": cohort.label,
            "label": cohort.label,
            "clean_filename": filename,
            "columns": [{"name": name, "is_system": False} for name in ordered_by_profile[cohort.profile_id]],
            "stats": stats,
        })
    return processed, skipped
