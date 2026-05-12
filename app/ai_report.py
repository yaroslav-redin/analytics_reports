import os
import json
import re
import ollama
from dotenv import load_dotenv
from mistralai.client import Mistral

load_dotenv()


def _extract_json(text: str) -> dict:
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if match:
        return json.loads(match.group(1).strip())
    raise ValueError("ИИ вернул ответ не в формате JSON")


def _build_group_prompt(answers: list[str], question_name: str) -> str:
    numbered = "\n".join(f"{i + 1}. {a}" for i, a in enumerate(answers))
    return (
        "Ты — эксперт по нормализации текстовых данных.\n"
        f"Вопрос анкеты: «{question_name}»\n\n"
        "Для каждого ответа из списка выполни нормализацию:\n"
        "1. Переведи на русский язык (если ответ на другом языке).\n"
        "2. Исправь явные опечатки в словах (например: «Туркмееистан» → «Туркменистан»).\n"
        "3. Приведи к именительному падежу (например: «России» → «Россия», «Из Индии» → «Индия»).\n"
        "4. Убери предлоги в начале («Из Туркменистана» → «Туркменистан»).\n"
        "5. Нормализуй аббревиатуры («РФ» → «Россия», «КНР» → «Китай»).\n"
        "6. Если ответ явно не относится к теме вопроса (имя человека, случайное слово, число) — "
        "оставь его в точности как есть.\n"
        "ВАЖНО: нормализуй каждый ответ строго по его смыслу. "
        "Не смешивай разные сущности (разные страны, разные понятия).\n\n"
        "Список ответов:\n"
        f"{numbered}\n\n"
        "Верни ТОЛЬКО валидный JSON без пояснений и без markdown:\n"
        '{"1": "нормализованный ответ", "2": "нормализованный ответ", ...}\n'
        "Ключи — номера из списка (строки), значения — нормализованные формы."
    )


def _parse_group_response(raw: str, answers: list[str]) -> list[dict]:
    parsed = _extract_json(raw)
    norm_map = {ans: parsed.get(str(i + 1), ans) for i, ans in enumerate(answers)}
    groups: dict[str, list[str]] = {}
    for ans in answers:
        groups.setdefault(norm_map[ans], []).append(ans)
    return [{"canonical": canon, "members": members} for canon, members in groups.items()]


def group_answers_local(answers: list[str], question_name: str) -> list[dict]:
    prompt = _build_group_prompt(answers, question_name)
    response = ollama.chat(
        model="mistral",
        messages=[{"role": "user", "content": prompt}]
    )
    return _parse_group_response(response.message.content.strip(), answers)


def group_answers_api(answers: list[str], question_name: str) -> list[dict]:
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise ValueError("MISTRAL_API_KEY не задан в .env")
    prompt = _build_group_prompt(answers, question_name)
    client = Mistral(api_key=api_key)
    response = client.chat.complete(
        model="mistral-small-latest",
        messages=[{"role": "user", "content": prompt}]
    )
    return _parse_group_response(response.choices[0].message.content.strip(), answers)


def _format_survey_data(questions: list[dict]) -> str:
    lines = []
    for q in questions:
        lines.append(f"\nВопрос {q['table_num']}: {q['question_name']}")

        file_keys = q['file_keys']
        file_labels = q['file_labels']
        file_totals = q['file_totals']

        if len(file_keys) == 1:
            fk = file_keys[0]
            total = file_totals.get(fk, 0)
            lines.append(f"  {'Вариант ответа':<45} {'Кол-во':>7} {'%':>6}")
            lines.append("  " + "-" * 60)
            for row in q['rows']:
                count = row['counts'].get(fk, 0)
                pct = f"{count / total * 100:.1f}%" if total else "0%"
                ans = row['answer'][:45]
                lines.append(f"  {ans:<45} {count:>7} {pct:>6}")
            lines.append(f"  {'Всего ответивших:':<45} {total:>7}")
        else:
            short_labels = {fk: file_labels.get(fk, fk)[:12] for fk in file_keys}
            header = f"  {'Вариант ответа':<40}"
            for fk in file_keys:
                header += f" | {short_labels[fk]:>14}"
            lines.append(header)
            lines.append("  " + "-" * (40 + 17 * len(file_keys)))
            for row in q['rows']:
                row_str = f"  {row['answer'][:40]:<40}"
                for fk in file_keys:
                    count = row['counts'].get(fk, 0)
                    total = file_totals.get(fk, 0)
                    pct = f"{count / total * 100:.0f}%" if total else "0%"
                    row_str += f" | {count:>6}({pct:>4})"
                lines.append(row_str)
            total_str = f"  {'Всего ответивших:':<40}"
            for fk in file_keys:
                total_str += f" | {file_totals.get(fk, 0):>14}"
            lines.append(total_str)

    return "\n".join(lines)


def generate_ai_report(questions: list[dict]) -> str:
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise ValueError("MISTRAL_API_KEY не задан в .env")

    survey_text = _format_survey_data(questions)

    has_multiple_groups = any(len(q['file_keys']) > 1 for q in questions)
    comparison_note = (
        "Сравни ответы между группами, выдели значимые различия."
        if has_multiple_groups else ""
    )

    prompt = (
        "Ты — аналитик социологических опросов. "
        "Проанализируй данные опроса и напиши аналитический отчёт на русском языке.\n\n"
        f"Данные опроса:\n{survey_text}\n\n"
        "Требования к отчёту:\n"
        "1. Для каждого вопроса: опиши распределение ответов, выдели доминирующие варианты.\n"
        f"2. {comparison_note}\n"
        "3. В конце — общие выводы.\n"
        "Пиши профессионально, без лишних повторений, как для официального аналитического документа."
    )

    client = Mistral(api_key=api_key)
    response = client.chat.complete(
        model="mistral-small-latest",
        messages=[{"role": "user", "content": prompt}]
    )

    return response.choices[0].message.content
