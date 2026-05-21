import json
import re
from app import config as cfg
from app.docx_gen import get_openrouter_client, _pace, _mark_request_done, _backoff_wait


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


def _parse_group_response(raw: str, answers: list[str]) -> list[dict]:
    parsed = _extract_json(raw)
    norm_map = {ans: parsed.get(str(i + 1), ans) for i, ans in enumerate(answers)}
    groups: dict[str, list[str]] = {}
    for ans in answers:
        groups.setdefault(norm_map[ans], []).append(ans)
    return [{"canonical": canon, "members": members} for canon, members in groups.items()]


def group_answers_openrouter(answers: list, question_name: str) -> list:
    prompt = _build_group_prompt(answers, question_name)
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
            return _parse_group_response(response.choices[0].message.content.strip(), answers)
        except Exception as e:
            if "429" in str(e) and attempt < 5:
                _backoff_wait(attempt)
            else:
                raise
