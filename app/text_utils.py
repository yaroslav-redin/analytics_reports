"""Очистка текстов вопросов и ответов от HTML-разметки редактора анкет."""
import html
import re

# Блочные теги разделяют слова — заменяем пробелом; строчные (<strong>, <em>…) — удаляем.
_BLOCK_TAG_RE = re.compile(r"</?(?:br|p|div|li|ul|ol|tr|td|th|h[1-6])\b[^<>]*>", re.IGNORECASE)
_TAG_RE = re.compile(r"</?[a-zA-Z][^<>]*>")


def strip_html(value):
    """Убирает теги и HTML-сущности (&nbsp;, &amp;…), схлопывает пробелы. Не-строки возвращает как есть."""
    if not isinstance(value, str):
        return value
    if "<" not in value and "&" not in value:
        return value
    text = _BLOCK_TAG_RE.sub(" ", value)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    # str.split() без аргументов режет и по неразрывному пробелу (\xa0 из &nbsp;).
    return " ".join(text.split())
