import json
import re
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from app import config as cfg
from app.docx_gen import (
    get_openrouter_client,
    _pace,
    _mark_request_done,
    _backoff_wait,
)


# ===================== ВСПОМОГАТЕЛЬНЫЕ =====================

def _extract_json(text: str) -> dict:
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if match:
        return json.loads(match.group(1).strip())
    raise ValueError("ИИ вернул ответ не в формате JSON")


def _build_group_prompt(answers: list, question_name: str) -> str:
    numbered = "\n".join(f"{i + 1}. {a}" for i, a in enumerate(answers))
    template = cfg.get("prompt_grouping")
    return template.format(question_name=question_name, answers=numbered)


def _build_groups_from_norm_map(original_answers: list[str], norm_map: dict[str, str]) -> list[dict]:
    """Группируем все исходные ответы (включая дубликаты) по их каноническому виду."""
    groups: dict[str, list[str]] = {}
    for ans in original_answers:
        canon = norm_map.get(ans, ans)
        groups.setdefault(canon, []).append(ans)
    return [{"canonical": canon, "members": members} for canon, members in groups.items()]


# ===================== КЭШ В ПАМЯТИ ПРОЦЕССА =====================

_grouping_cache: dict[str, list[dict]] = {}
_grouping_cache_lock = threading.Lock()


def _grouping_cache_key(unique_answers: list[str], question_name: str) -> str:
    payload = json.dumps(
        {
            "answers":  sorted(unique_answers),
            "q":        question_name,
            "model":    cfg.get("openrouter_model"),
            "prompt":   hashlib.md5(cfg.get("prompt_grouping").encode()).hexdigest(),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


# ===================== ВЫЗОВ LLM ДЛЯ ОДНОГО БАТЧА =====================

def _normalize_batch(batch_answers: list[str], question_name: str) -> dict[str, str]:
    """
    Один вызов LLM на батч ответов.
    Возвращает {original_answer: normalized_answer}.
    """
    prompt = _build_group_prompt(batch_answers, question_name)
    client = get_openrouter_client()

    _pace()
    for attempt in range(6):
        try:
            response = client.chat.completions.create(
                model=cfg.get("openrouter_model"),
                messages=[{"role": "user", "content": prompt}],
                max_tokens=cfg.get_int("llm_max_tokens_grouping"),
                temperature=cfg.get_float("llm_temperature"),
            )
            _mark_request_done()
            parsed = _extract_json(response.choices[0].message.content.strip())
            # ключи парсера — строки "1", "2", ... в пределах батча
            return {
                ans: parsed.get(str(i + 1), ans)
                for i, ans in enumerate(batch_answers)
            }
        except Exception as e:
            if "429" in str(e) and attempt < 5:
                _backoff_wait(attempt)
            else:
                raise

    # сюда не доходим (либо вернули, либо raise)
    return {ans: ans for ans in batch_answers}


# ===================== ПАРАЛЛЕЛЬНАЯ НОРМАЛИЗАЦИЯ БАТЧЕЙ =====================

def _normalize_in_parallel(
    batches: list[list[str]],
    question_name: str,
    cancel_event: threading.Event | None = None,
) -> dict[str, str]:
    """
    Параллельно нормализует несколько батчей, объединяет результаты в общую norm_map.
    При любой ошибке в каком-то батче — пробрасывает первую пойманную ошибку наверх,
    чтобы поведение совпадало со старым (всё или ничего).
    """
    max_workers = max(1, cfg.get_int("llm_group_max_concurrency"))
    merged: dict[str, str] = {}
    first_error: Exception | None = None

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {
            ex.submit(_normalize_batch, batch, question_name): idx
            for idx, batch in enumerate(batches)
        }
        for fut in as_completed(futures):
            if cancel_event and cancel_event.is_set():
                for f in futures:
                    f.cancel()
                return {}
            try:
                merged.update(fut.result())
            except Exception as e:
                if first_error is None:
                    first_error = e

    if first_error is not None:
        raise first_error
    return merged


# ===================== ПУБЛИЧНАЯ ТОЧКА ВХОДА =====================

def group_answers_openrouter(
    answers: list,
    question_name: str,
    cancel_event: threading.Event | None = None,
) -> list[dict]:
    """
    Группирует ответы через LLM.
    Оптимизации:
      • дедуп уникальных ответов (LLM не обрабатывает повторы)
      • батчинг крупных списков
      • параллельные запросы (до llm_group_max_concurrency одновременно)
      • кэш в памяти процесса по хэшу (уникальные ответы + вопрос + модель + промпт)
    """
    if not answers:
        return []

    answers_str = [str(a) for a in answers]

    unique_answers = list(dict.fromkeys(answers_str))

    cache_key = _grouping_cache_key(unique_answers, question_name)
    with _grouping_cache_lock:
        cached = _grouping_cache.get(cache_key)
    if cached is not None:
        print(f"[group_answers] CACHE HIT ({len(unique_answers)} уникальных)")
        norm_map = {}
        for grp in cached:
            for m in grp["members"]:
                norm_map[m] = grp["canonical"]
        return _build_groups_from_norm_map(answers_str, norm_map)

    if cancel_event and cancel_event.is_set():
        return []

    batch_size = max(1, cfg.get_int("llm_group_batch_size"))
    batches = [
        unique_answers[i : i + batch_size]
        for i in range(0, len(unique_answers), batch_size)
    ]

    print(
        f"[group_answers] {len(answers_str)} ответов → "
        f"{len(unique_answers)} уникальных → "
        f"{len(batches)} батч(ей) по ≤{batch_size}, "
        f"параллельно до {cfg.get_int('llm_group_max_concurrency')}"
    )

    norm_map = _normalize_in_parallel(batches, question_name, cancel_event=cancel_event)

    if cancel_event and cancel_event.is_set():
        return []

    groups = _build_groups_from_norm_map(answers_str, norm_map)

    with _grouping_cache_lock:
        _grouping_cache[cache_key] = groups

    return groups
