# Техническая документация
# Система аналитики опросов МГУ им. Н.П. Огарёва

---

## Содержание

1. [Общее описание](#1-общее-описание)
2. [Стек технологий](#2-стек-технологий)
3. [Архитектура системы](#3-архитектура-системы)
4. [Структура проекта](#4-структура-проекта)
5. [Установка и запуск](#5-установка-и-запуск)
6. [Переменные окружения](#6-переменные-окружения)
7. [База данных](#7-база-данных)
8. [Аутентификация и авторизация](#8-аутентификация-и-авторизация)
9. [API-эндпоинты](#9-api-эндпоинты)
10. [Жизненный цикл запроса пользователя](#10-жизненный-цикл-запроса-пользователя)
11. [Фоновые задачи](#11-фоновые-задачи)
12. [Интеграция с LLM](#12-интеграция-с-llm)
13. [Экспорт в Word (DOCX)](#13-экспорт-в-word-docx)
14. [Конфигурация приложения](#14-конфигурация-приложения)
15. [Фронтенд](#15-фронтенд)
16. [Безопасность](#16-безопасность)
17. [Ограничения и масштабируемость](#17-ограничения-и-масштабируемость)
18. [Детальное описание бэкенд-модулей](#18-детальное-описание-бэкенд-модулей)

---

## 1. Общее описание

Веб-приложение автоматизирует обработку результатов студенческих опросов для отдела анкетирования ФГБОУ ВО «МГУ им. Н.П. Огарёва». До внедрения системы сотрудники обрабатывали выгрузки Excel вручную.

**Основной сценарий использования:**

1. Пользователь загружает Excel/CSV-файл с данными опроса.
2. Система очищает данные и предлагает выбрать вопросы для анализа.
3. Пользователь настраивает визуализацию (тип графика, заголовки, группировку файлов).
4. При необходимости ИИ нормализует свободные текстовые ответы (группировка синонимов).
5. Пользователь задаёт структуру отчёта — разделы, заголовки, титульный лист.
6. Система генерирует Word-документ с аналитическими текстами (ИИ), редактируемыми OOXML-графиками и итоговыми выводами.

---

## 2. Стек технологий

| Компонент | Технология |
|-----------|-----------|
| Бэкенд | Python 3.11+, FastAPI, uvicorn |
| Шаблонизатор | Jinja2 |
| Обработка данных | Pandas, PyArrow (Parquet) |
| База данных | SQLite (aiosqlite — асинхронный драйвер) |
| Аутентификация | OAuth 2.0 через EIOS (p.mrsu.ru) |
| LLM | GigaChat API — Сбер (по умолчанию модель `GigaChat-2`) |
| Генерация Word | python-docx + ручная сборка OOXML-графиков |
| Фронтенд | Bootstrap 5, Chart.js, Select2, SortableJS |
| Сессии | Starlette SessionMiddleware (itsdangerous) |
| Rate limiting | slowapi |
| HTTP-клиент | httpx (OAuth ЭИОС), gigachat SDK (GigaChat) |

---

## 3. Архитектура системы

```
Браузер (JS wizard)
       │  HTTP/SSE
       ▼
┌─────────────────────────────────────────────────────┐
│              FastAPI (app/main.py)                  │
│                                                     │
│  AuthMiddleware → SessionMiddleware → Rate Limiter  │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  /upload │  │/analyze  │  │/export_docx_start │  │
│  │/process_ │  │/ai_group_│  │/export_docx_stream│  │
│  │  sheets  │  │  start   │  │  (SSE)            │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
│        │              │               │             │
│        ▼              ▼               ▼             │
│  uploads/{sid}/  AiGroupTask    ExportTask          │
│  (Parquet-файлы) (threading)    (threading+SSE)     │
└─────────────────────────────────────────────────────┘
       │                                  │
       ▼                                  ▼
  SQLite DB                        GigaChat API
  (settings, users,                (LLM-вызовы)
   sessions, reports)
```

### Принцип изоляции сессий

Каждая загрузка файлов создаёт уникальную папку `uploads/{session_id}/` (UUID v4). Владелец сессии фиксируется в файле `_owner` внутри папки. Все последующие эндпоинты проверяют владение сессией перед обработкой данных.

---

## 4. Структура проекта

```
survey_analytics_app/
├── app/
│   ├── main.py          — FastAPI-приложение, все HTTP-эндпоинты, ExportTask, AiGroupTask
│   ├── auth.py          — OAuth 2.0 (EIOS), роутер /auth/*
│   ├── config.py        — настройки: in-memory кэш поверх SQLite; DEFAULTS
│   ├── database.py      — aiosqlite-функции (init, upsert_user, log_*, cleanup)
│   ├── schemas.py       — Pydantic-модели запросов и ответов
│   ├── data_logic.py    — очистка DataFrame, агрегация ответов
│   ├── ai_report.py     — ИИ-группировка свободных ответов (батчи + параллелизм + кэш)
│   ├── docx_gen.py      — генерация Word: LLM-аналитика + OOXML-графики
│   ├── chart_gen.py     — сборка редактируемых OOXML-графиков для .docx
│   ├── static/
│   │   ├── css/app.css
│   │   └── js/modules/  — ES-модули фронтенда (wizard, upload, sheets, …)
│   └── templates/       — Jinja2-шаблоны (index.html, login.html, partials/)
├── uploads/             — временные файлы сессий (очищаются через 6 ч)
├── certs/
│   └── russian_trusted_ca_bundle.pem  — Root + Sub CA НУЦ Минцифры для TLS к GigaChat
├── scripts/
│   ├── check_ca_cert_expiry.sh              — автообновление Sub CA (см. §12)
│   ├── analytics_reports-cert-check.service — systemd-юнит для скрипта выше
│   └── analytics_reports-cert-check.timer   — ежедневный таймер
├── survey_analytics.db  — SQLite-база данных
├── requirements.txt
├── .env                 
└── .env.example         
```

---

## 5. Установка и запуск

### Предварительные требования

- Python 3.11+
- Зарегистрированный OAuth-клиент в EIOS (`p.mrsu.ru`)
- Authorization key GigaChat (для LLM-функций), получается в личном кабинете developers.sber.ru

### Установка

```powershell
# 1. Создать и активировать виртуальное окружение
python -m venv venv
.\venv\Scripts\activate

# 2. Установить зависимости
pip install -r requirements.txt

# 3. Создать .env на основе шаблона и заполнить значения
copy .env.example .env
```

### Запуск

```powershell
# Порт 64548 зарегистрирован в EIOS OAuth как redirect_uri
uvicorn app.main:app --reload --port 64548
```

При старте приложение:
1. Инициализирует SQLite-базу данных (`init_db()`).
2. Загружает настройки из таблицы `settings` в in-memory кэш.
3. Удаляет устаревшие сессии (старше 6 ч).
4. Запускает фоновый asyncio-цикл очистки.

---

## 6. Переменные окружения

| Переменная | Обязательная | Описание |
|-----------|:---:|---------|
| `SESSION_SECRET_KEY` | да | Ключ подписи cookie-сессий (мин. 32 случайных символа) |
| `EIOS_CLIENT_ID` | да | OAuth client_id, выданный EIOS |
| `EIOS_CLIENT_SECRET` | да | OAuth client_secret |
| `EIOS_REDIRECT_URI` | нет | Callback-URL; по умолчанию `http://localhost:64548/signin-eios` |
| `EIOS_ALLOWED_ROLE` | нет | Если задана — пускать только пользователей с этой ролью |
| `ADMIN_USER_IDS` | нет | Comma-separated EIOS-ID пользователей, которым сразу даётся is_admin |
| `GIGACHAT_CREDENTIALS` | нет* | Authorization key GigaChat; без него LLM-функции недоступны |
| `GIGACHAT_SCOPE` | нет | `GIGACHAT_API_PERS` (физлицо) / `GIGACHAT_API_B2B` / `GIGACHAT_API_CORP`; по умолчанию `GIGACHAT_API_PERS` |
| `GIGACHAT_MODEL` | нет | Модель GigaChat; по умолчанию `GigaChat-2`. Доступные модели зависят от тарифа — список: `client.get_models()` |
| `GIGACHAT_CA_BUNDLE_FILE` | нет | Путь к сертификатам НУЦ Минцифры; по умолчанию `certs/russian_trusted_ca_bundle.pem` (входит в репозиторий) |
| `DB_PATH` | нет | Путь к SQLite-файлу; по умолчанию `survey_analytics.db` |
| `HTTPS_ONLY` | нет | `true` — cookie `Secure`; для продакшена через HTTPS |

\* Без `GIGACHAT_CREDENTIALS` кнопки «Группировать ИИ» и генерация аналитического текста вернут ошибку, но остальные функции работают.

---

## 7. База данных

SQLite-файл `survey_analytics.db`. Схема создаётся автоматически при старте.

### Таблицы

#### `settings`
Хранит переопределения конфигурации (промпты, модель, цвета, пороговые значения).

| Столбец | Тип | Описание |
|---------|-----|---------|
| `key` | TEXT PK | Ключ настройки |
| `value` | TEXT | Значение (строка/JSON) |
| `updated_at` | TEXT | Дата изменения |

#### `users`
Пользователи, вошедшие через EIOS OAuth.

| Столбец | Тип | Описание |
|---------|-----|---------|
| `id` | TEXT PK | EIOS User ID |
| `email` | TEXT | |
| `fio` | TEXT | Полное ФИО |
| `short_fio` | TEXT | «Фамилия И.О.» |
| `username` | TEXT | Логин EIOS |
| `roles` | TEXT | JSON-массив ролей |
| `photo_url` | TEXT | URL фото |
| `created_at` | TEXT | Первый вход |
| `last_login` | TEXT | Последний вход |
| `is_admin` | INTEGER | 0/1 — права администратора |
| `is_banned` | INTEGER | 0/1 — запрет входа |

#### `upload_sessions`
Журнал загруженных файлов.

| Столбец | Тип | Описание |
|---------|-----|---------|
| `session_id` | TEXT PK | UUID сессии |
| `user_id` | TEXT FK | Владелец |
| `files` | TEXT | JSON-массив загруженных файлов |
| `created_at` | TEXT | |

#### `generated_reports`
Журнал сгенерированных отчётов.

| Столбец | Тип | Описание |
|---------|-----|---------|
| `id` | INTEGER PK | Автоинкремент |
| `session_id` | TEXT | Сессия загрузки |
| `user_id` | TEXT FK | |
| `filename` | TEXT | Имя файла отчёта |
| `question_count` | INTEGER | Количество вопросов |
| `generated_at` | TEXT | |

### Очистка старых записей

Фоновый цикл каждые 6 часов удаляет записи из `upload_sessions` и `generated_reports`, созданные более 6 часов назад.

---

## 8. Аутентификация и авторизация

### OAuth 2.0 (EIOS)

Поток Authorization Code:

```
Браузер  →  GET /auth/login
         ←  302 https://p.mrsu.ru/OAuth/Authorize?...&state=<csrf_token>

Браузер  →  GET /signin-eios?code=...&state=...
         ←  POST https://p.mrsu.ru/OAuth/Token  (обмен кода на токены)
         ←  GET  https://papi.mrsu.ru/v1/User   (получение профиля)
         ←  302 /  (сессия установлена)
```

После успешного входа данные пользователя сохраняются в `request.session["user"]` (подписанный cookie через `itsdangerous`).

### Middleware аутентификации (`AuthMiddleware`)

Проверяет наличие `user` в сессии для всех путей, кроме:
- `/login`, `/auth/login`, `/auth/logout`, `/signin-eios`, `/auth/me` — публичные
- `/static/*` — статические файлы

При отсутствии сессии:
- GET-запросы к страницам (`/`, `/users`, `/settings`) → редирект на `/login`
- API-запросы → `401 Not authenticated`

### Роли и права

| Роль | Условие | Возможности |
|------|---------|------------|
| Пользователь | Любой авторизованный | Загрузка файлов, анализ, экспорт |
| Администратор | `is_admin = 1` в БД | + управление пользователями, редактирование настроек |
| Заблокированный | `is_banned = 1` | Вход запрещён, редирект с ошибкой |

Первые администраторы назначаются через переменную `ADMIN_USER_IDS`. Далее администраторы управляют правами через `/users`.

---

## 9. API-эндпоинты

### Страницы

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/` | Главная страница (6-шаговый мастер) |
| GET | `/login` | Страница входа |
| GET | `/users` | Управление пользователями (admin only) |
| GET | `/settings` | Настройки приложения (admin only) |

### Аутентификация

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/auth/login` | Редирект на EIOS OAuth |
| GET | `/signin-eios` | OAuth callback — обмен кода на сессию |
| GET | `/auth/logout` | Очистка сессии |
| GET | `/auth/me` | Текущий пользователь (JSON) |

### API настроек (admin only)

| Метод | Путь | Rate limit | Описание |
|-------|------|-----------|---------|
| GET | `/api/settings` | — | Получить все настройки (ключ API скрыт) |
| POST | `/api/settings` | 20/мин | Сохранить настройки |
| GET | `/api/settings/defaults` | — | Значения по умолчанию |

### API пользователей (admin only)

| Метод | Путь | Rate limit | Описание |
|-------|------|-----------|---------|
| POST | `/api/users/{user_id}/set_admin` | 20/мин | Назначить/снять администратора |
| POST | `/api/users/{user_id}/set_banned` | 20/мин | Заблокировать/разблокировать |

### Основной рабочий процесс

| Метод | Путь | Rate limit | Описание |
|-------|------|-----------|---------|
| POST | `/upload` | 10/мин | Загрузить Excel/CSV-файлы, получить список листов |
| POST | `/process_sheets` | 30/мин | Очистить данные, сохранить Parquet |
| POST | `/analyze` | 30/мин | Агрегировать ответы, вернуть JSON |
| POST | `/ai_group_start` | 30/мин | Запустить фоновую нормализацию ответов |
| GET | `/ai_group_result/{task_id}` | — | Long-poll: дождаться результата группировки |
| POST | `/ai_group_cancel/{task_id}` | — | Отменить задачу группировки |
| POST | `/export_docx_start` | 5/мин | Запустить фоновую генерацию Word-отчёта |
| GET | `/export_docx_stream/{task_id}` | — | SSE-поток прогресса и результата |
| POST | `/export_docx_cancel/{task_id}` | — | Отменить генерацию отчёта |

### Форматы запросов и ответов

#### `POST /upload`
- **Запрос:** `multipart/form-data`, поле `files[]`
- **Ограничения:** до `max_upload_files` файлов, не более 50 МБ каждый, форматы: xlsx, xls, csv, tsv
- **Ответ:** `{"files": [...], "session_id": "uuid"}`

#### `POST /process_sheets`
```json
{
  "session_id": "uuid",
  "files": [{"filename": "raw_data.xlsx", "sheets": ["Лист1"]}]
}
```
Ответ: список очищенных файлов с колонками и признаком системных полей.

#### `POST /analyze`
```json
{
  "session_id": "uuid",
  "file_labels": {"raw_data.xlsx": "2024"},
  "file_colors": {"raw_data.xlsx": "#FF0000"},
  "configs": [{
    "column": "Вопрос 1",
    "viz_type": ["bar"],
    "file_mapping": {"raw_data.xlsx": "clean_raw_data.xlsx.parquet"},
    "merged_columns": []
  }]
}
```

#### `POST /export_docx_start`
```json
{
  "session_id": "uuid",
  "title_page_body": "# Отчёт...",
  "title_page_approval": "УТВЕРЖДАЮ...",
  "questions": [{
    "table_num": 1,
    "question_name": "Вопрос 1",
    "h1": "Заголовок",
    "h2": "",
    "h3": "",
    "file_keys": ["raw_data.xlsx"],
    "file_labels": {"raw_data.xlsx": "2024"},
    "rows": [{"answer": "Да", "counts": {"raw_data.xlsx": 42}}],
    "file_totals": {"raw_data.xlsx": 100},
    "show_total": true,
    "viz_tab": "bar",
    "chart_direction": "y",
    "show_legend": true,
    "hidden_col": "none",
    "skip_analytics": false
  }]
}
```

#### SSE-поток `/export_docx_stream/{task_id}`
Сервер отправляет события:
```
data: {"type": "progress", "current": 3, "total": 10, "label": "Вопрос 3..."}
data: {"type": "done", "file": "<base64>", "filename": "report_20240101_120000.docx"}
data: {"type": "error", "message": "Текст ошибки"}
```

---

## 10. Жизненный цикл запроса пользователя

```
Шаг 1: POST /upload
  → Создать uploads/{session_id}/
  → Записать файлы как raw_{name}
  → Определить листы (для CSV — один лист)
  → Удалить предыдущие сессии пользователя
  → Логировать в upload_sessions

Шаг 2: POST /process_sheets
  → Прочитать raw_-файлы
  → clean_dataframe() — удалить числовые префиксы, нормализовать возраст
  → Сохранить clean_{name}.parquet
  → Вернуть список колонок

Шаг 3: POST /analyze
  → Прочитать Parquet-файлы
  → generate_report_data() — подсчитать ответы по каждой колонке
  → Вернуть JSON с агрегированными данными

Шаг 4 (опционально): POST /ai_group_start → GET /ai_group_result/{id}
  → LLM нормализует свободные ответы
  → Результат возвращается в браузер для отображения

Шаг 5: Настройка структуры в браузере (без запросов к серверу)

Шаг 6: POST /export_docx_start → GET /export_docx_stream/{id}
  → Фоновый поток: LLM-аналитика + сборка OOXML-документа
  → SSE-поток прогресса в браузер
  → Готовый файл передаётся как base64 в SSE-событии "done"
  → Браузер скачивает файл через Blob URL
```

---

## 11. Фоновые задачи

### ExportTask (`app/main.py`)

Менеджер генерации DOCX. Один экземпляр на задачу, хранится в `_export_tasks: dict[str, ExportTask]`.

| Атрибут | Описание |
|---------|---------|
| `status` | `running` / `done` / `error` / `cancelled` |
| `progress` | `{current, total, label}` |
| `result_b64` | base64-содержимое .docx (только при `done`) |
| `cancel_event` | `threading.Event` для кооперативной отмены |
| `subscribers` | Список `asyncio.Queue` (по одной на SSE-клиента) |
| `loop` | Event loop для `call_soon_threadsafe` |

**Метод `_emit(msg)`** — атомарно (через `threading.Lock`) обновляет состояние и помещает сообщение в очереди всех подписчиков. Позволяет нескольким вкладкам одновременно наблюдать одну задачу.

**Метод `subscribe()`** — атомарно возвращает текущий snapshot + регистрирует новую очередь. Гарантирует, что клиент не пропустит сообщения, отправленные между получением snapshot и началом ожидания.

Задачи удаляются через 1 час после завершения.

### AiGroupTask (`app/main.py`)

Аналогичная структура для фоновой ИИ-группировки ответов. Использует long-poll (`GET /ai_group_result/{id}`) вместо SSE, поскольку группировка — одноразовая операция (нет промежуточных шагов прогресса).

---

## 12. Интеграция с LLM

### Клиент (`app/docx_gen.py`)

Singleton `GigaChat`-клиент (пакет `gigachat`), аутентификация по Authorization key через OAuth2:

```python
GigaChat(
    credentials=cfg.get("gigachat_credentials"),
    scope=cfg.get("gigachat_scope"),
    ca_bundle_file=cfg.get("gigachat_ca_bundle_file"),
    timeout=cfg.get_int("llm_request_timeout"),
)
```

Пересоздаётся автоматически при изменении ключа через настройки. TLS проверяется по сертификату НУЦ Минцифры (`certs/russian_trusted_ca_bundle.pem`, входит в репозиторий). Токен доступа (TTL ~30 мин) обновляется библиотекой автоматически.

Вызовы идут через общую обёртку `_chat_completion(messages, max_tokens, temperature)`, которая использует совместимый со старым форматом метод `client.chat({...})` и возвращает `response.choices[0].message.content`.

### Сертификат НУЦ Минцифры и его автообновление

`certs/russian_trusted_ca_bundle.pem` содержит два сертификата: Root CA (действует до 2032, самоподписанный, служит корнем доверия) и Sub CA (действует до 2027-03-06, именно им подписаны серверные сертификаты `api.giga.chat`).

Скрипт `scripts/check_ca_cert_expiry.sh`, запускаемый ежедневным systemd-таймером на проде (см. `DEPLOY.md` §10), обновляет только Sub CA:
1. Если до истечения текущего Sub CA ≥ 60 дней — ничего не делает (без записи в лог, чтобы не расходовать место на диске).
2. Иначе скачивает свежий Sub CA с `gu-st.ru` и проверяет его подпись через `openssl verify -CAfile <Root CA>` — то есть криптографически убеждается, что новый сертификат действительно выпущен тем же Root CA, которому мы уже доверяем. Подделать эту подпись без приватного ключа НУЦ Минцифры невозможно, поэтому проверка одинаково надёжна независимо от того, кто инициировал загрузку.
3. Если подпись верна и сертификат отличается от текущего — атомарно заменяет `certs/russian_trusted_ca_bundle.pem` и перезапускает `analytics_reports.service`.
4. Если подпись не проходит проверку (сеть отдала не то, что нужно) — файл не трогает, пишет ошибку в лог и завершается с ошибкой (юнит виден как `failed`).

Root CA автообновлением не покрыт — он действует до 2032, и это осознанное решение: обновление корня доверия должно быть отдельной ручной операцией (заменить файл, проверить отпечаток по независимому источнику, закоммитить), а не автоматическим шагом.

### Управление темпом запросов

- **`_pace()`** — добавляет паузу `llm_sleep_between_calls` секунд между вызовами.
- **`_backoff_wait(attempt)`** — экспоненциальный backoff при `gigachat.exceptions.RateLimitError`: `2^attempt * (1 + random) * 3` секунды.
- Максимум 6 попыток на один вызов.

### Группировка ответов (`app/ai_report.py`)

Оптимизации, применённые последовательно:

1. **Дедупликация** — LLM обрабатывает только уникальные ответы.
2. **Батчинг** — не более `llm_group_batch_size` (по умолчанию 50) ответов в одном запросе.
3. **Параллелизм** — до `llm_group_max_concurrency` (по умолчанию 3) одновременных запросов через `ThreadPoolExecutor`.
4. **Кэш** — результат сохраняется в памяти процесса по MD5-хэшу от (уникальные ответы + название вопроса + модель + хэш промпта). Сбрасывается только при перезапуске.

### LLM-аналитика для DOCX (`app/docx_gen.py`)

Для каждого вопроса LLM генерирует аналитический абзац (4–6 предложений). Параллелизация — `ThreadPoolExecutor` с семафором. Кэш аналогичен кэшу группировки.

Кроме вопросов генерируются:
- **Выводы по разделам** — суммаризация всех вопросов раздела (3–5 предложений).
- **Итоговые выводы** — 4–5 связных абзацев по всему опросу с рекомендациями.

---

## 13. Экспорт в Word (DOCX)

### Структура документа

```
Титульный лист (опционально)
├── Страница утверждения
└── Вводный текст
─────────────────────
Для каждого вопроса:
├── Заголовок H1/H2/H3
├── Аналитический абзац (LLM)
├── График или таблица (OOXML)
└── Подпись таблицы
─────────────────────
Выводы по разделу (если вопрос последний в разделе)
─────────────────────
Итоговые выводы
```

### OOXML-графики (`app/chart_gen.py`)

Используются редактируемые графики Word (не изображения), совместимые с Microsoft Word и LibreOffice. Каждый график содержит встроенную книгу Excel (`xl/embeddings/`), что позволяет пользователю редактировать данные прямо в Word.

Поддерживаемые типы:
- **Столбчатая диаграмма** — горизонтальная (`bar`) или вертикальная (`column`)
- **Круговая диаграмма** (`pie`)
- **Таблица** — форматированная таблица Word без графика
- **Смешанный режим** (`both`) — два графика рядом: столбчатый и круговой

### Отмена генерации

`threading.Event` (`cancel_event`) устанавливается при вызове `POST /export_docx_cancel/{task_id}`. Генератор проверяет флаг между вопросами — следующий вопрос не начинает обработку.

---

## 14. Конфигурация приложения

Все настройки хранятся в таблице `settings` SQLite. При старте загружаются в `_cache` (модуль `app/config.py`). Значения по умолчанию — в словаре `DEFAULTS`.

### Доступ к настройкам

```python
cfg.get("gigachat_model")            # → str
cfg.get_int("llm_max_tokens_analysis")  # → int
cfg.get_float("llm_temperature")     # → float
cfg.get_json("pie_colors")           # → list/dict
```

### Ключевые параметры

| Ключ | По умолчанию | Описание |
|------|-------------|---------|
| `gigachat_model` | `GigaChat-2` | Модель LLM |
| `gigachat_scope` | `GIGACHAT_API_PERS` | Тип доступа (физлицо/юрлицо) |
| `llm_temperature` | `0.4` | Температура генерации |
| `llm_max_tokens_analysis` | `600` | Макс. токенов на аналитический абзац |
| `llm_max_tokens_grouping` | `2000` | Макс. токенов на группировку |
| `llm_sleep_between_calls` | `3` | Пауза между LLM-запросами (сек) |
| `llm_group_batch_size` | `50` | Размер батча при группировке |
| `llm_group_max_concurrency` | `3` | Параллельных запросов при группировке |
| `max_upload_files` | `10` | Максимум файлов за одну загрузку |
| `prompt_grouping` | — | Промпт для нормализации ответов |
| `prompt_system_role` | — | Системный промпт для LLM-аналитики |
| `prompt_writing_rules` | — | Правила стиля аналитических текстов |
| `system_columns_exact` | JSON-список | Точные имена системных колонок |
| `system_columns_contains` | JSON-список | Подстроки системных колонок |
| `pie_colors` | 25 цветов | Палитра круговых диаграмм |
| `default_file_colors` | 10 цветов | Цвета файлов для столбчатых диаграмм |

Администраторы изменяют настройки через интерфейс `/settings`. Изменения применяются немедленно (обновляется `_cache`) без перезапуска сервера. Исключение — новый ключ GigaChat: singleton-клиент пересоздаётся при следующем вызове.

---

## 15. Фронтенд

Одностраничное приложение на чистом JavaScript (без сборки). Все модули — стандартные ES-модули, подключённые напрямую.

### Глобальное состояние — `window.appData` (`state.js`)

Единственный источник истины. Структура:

```javascript
{
  sessionId: "uuid",
  files: [...],          // загруженные файлы с листами
  processedFiles: [...], // очищенные файлы с колонками
  configs: [...],        // конфигурация вопросов
  analyzeResults: [...], // агрегированные данные
  questions: [...],      // вопросы для экспорта (шаг 5)
  sections: [...],       // разделы отчёта
  fileLabels: {},        // подписи файлов
  fileColors: {},        // цвета файлов
}
```

### 6-шаговый мастер (`wizard.js`)

| Шаг | Модуль | Действие |
|-----|--------|---------|
| 1 | `upload.js` | Перетащить/выбрать файлы → `POST /upload` |
| 2 | `sheets.js` | Выбрать листы → `POST /process_sheets` |
| 3 | `questions.js` | Настроить вопросы, тип графика, маппинг файлов |
| 4 | `step4.js` | Предпросмотр Chart.js + ИИ-группировка → `POST /ai_group_start` |
| 5 | `step5.js` | Настроить разделы, заголовки, порядок |
| 6 | `step6.js` | Генерация → SSE `/export_docx_stream` → скачать .docx |

### Нечёткий поиск (`fuzzy.js`)

Кастомная реализация поиска для Select2 — позволяет находить колонки по частичному совпадению без учёта регистра.

---

## 16. Безопасность

### Применённые меры

| Угроза | Мера защиты |
|--------|------------|
| CSRF в OAuth | Параметр `state` (случайный токен в сессии) |
| Path traversal при чтении файлов | `os.path.realpath()` — проверка что путь внутри папки сессии |
| Доступ к чужим данным | Владение сессией: UUID в `_owner`-файле сверяется с `user["id"]` |
| Перебор/DoS | slowapi rate limiting на все значимые эндпоинты |
| Переполнение диска | Ограничение 50 МБ на файл, до 10 файлов, 100 000 строк |
| Утечка API-ключа | `_REDACTED_SETTINGS` маскирует ключ в `/api/settings` |
| XSS в шаблонах | Jinja2 auto-escape включён по умолчанию |
| Перехват сессии | `https_only=True` при `HTTPS_ONLY=true` |
| Инъекция имени файла | `os.path.basename()` для имён загружаемых файлов |

### Ограничения на одновременные задачи

- Не более 2 активных задач генерации DOCX на пользователя.
- При превышении — HTTP 429 с понятным сообщением.

---

## 17. Ограничения и масштабируемость

### Текущие ограничения

- **Один процесс** — `_export_tasks` и `_ai_group_tasks` хранятся в памяти. При перезапуске или нескольких воркерах задачи теряются.
- **Кэш LLM в памяти** — сбрасывается при перезапуске. При повторной генерации тех же данных LLM вызывается повторно.
- **SQLite** — достаточно для единственного сервера, не масштабируется горизонтально.
- **Файлы сессий на диске** — при нескольких инстансах нужно общее хранилище.
- **Блокирующие LLM-вызовы** — выполняются в `threading.Thread`, не в async; при большой нагрузке будут конкурировать за GIL с основными потоками uvicorn.

### Рекомендации для продакшена

- Запускать uvicorn с одним воркером: `--workers 1` (из-за in-memory состояния задач).
- Развернуть за nginx/caddy с HTTPS; установить `HTTPS_ONLY=true`.
- Настроить периодический бэкап `survey_analytics.db`.
- При необходимости горизонтального масштабирования — заменить in-memory задачи на Redis/Celery.

---

## 18. Детальное описание бэкенд-модулей

---

### `app/config.py`

**Ответственность:** единый реестр всех настраиваемых параметров. In-memory кэш поверх таблицы `settings` в SQLite; значения по умолчанию захардкожены в `DEFAULTS`.

#### `DEFAULTS: dict`

Словарь всех поддерживаемых ключей. Разделы:
- **LLM** — модель, токены, температура, паузы, размер батча, параллелизм.
- **Prompts** — системный промпт, правила стиля, пример аналитики, промпт группировки, промпты выводов по разделу и итоговых выводов, шаблоны титульного листа.
- **Colors** — `pie_colors` (25 цветов), `default_file_colors` (10 цветов).
- **Data processing** — `system_columns_exact`, `system_columns_contains`, `missing_value_placeholder`, `max_upload_files`.

#### Функции доступа

| Функция | Что делает |
|---------|-----------|
| `get(key, fallback)` | Читает `_cache`, затем `DEFAULTS`. Возвращает `str`. |
| `get_int(key)` | `int(get(key))` |
| `get_float(key)` | `float(get(key))` |
| `get_json(key)` | `json.loads(get(key))` — для JSON-значений (палитры, списки) |
| `all_with_defaults()` | `{**DEFAULTS, **_cache}` — полная картина, используется на странице `/settings` и для передачи цветов на фронтенд |

#### `async load(db_path)`

Вызывается один раз при старте. Читает все строки `settings` в `_cache`. При ошибке молча пропускает (БД может ещё не существовать).

#### `async save_all(updates, db_path)`

`UPSERT` в `settings` для каждого ключа, затем обновляет `_cache`. Изменения применяются без перезапуска.

---

### `app/database.py`

**Ответственность:** все SQL-операции через `aiosqlite`. Не содержит бизнес-логики.

#### `async init_db()`

`CREATE TABLE IF NOT EXISTS` для четырёх таблиц + прогон `_MIGRATIONS`. Каждую миграцию (`ALTER TABLE`) оборачивает в `try/except` — не падает, если столбец уже добавлен.

#### `async upsert_user(user) → {"is_admin": bool, "is_banned": bool}`

`INSERT ... ON CONFLICT DO UPDATE`. Специальное правило: если `user["id"]` входит в `ADMIN_USER_IDS` — `is_admin = 1` при любом входе; иначе флаг в БД не понижается (перелогин не снимает права). Возвращает флаги для немедленного применения в сессии.

#### `async pop_user_sessions(user_id) → list[str]`

Удаляет все `upload_sessions` и `generated_reports` пользователя. Возвращает список `session_id` для очистки папок на диске. Вызывается при каждой новой загрузке.

#### `async cleanup_old_records(session_max_age_hours)`

`DELETE` из `upload_sessions` и `generated_reports` по `datetime('now', '-N hours')`. Вызывается при старте и каждые 6 часов в фоне.

#### Остальные функции

`log_upload_session`, `log_generated_report` — простые `INSERT`.  
`get_all_users` — `SELECT` с сортировкой по `last_login DESC`.  
`set_user_admin` / `set_user_banned` — `UPDATE users SET ... WHERE id`.

---

### `app/auth.py`

**Ответственность:** OAuth 2.0 Authorization Code через EIOS (`p.mrsu.ru`).

#### EIOS-эндпоинты

| Эндпоинт | URL |
|----------|-----|
| Authorization | `https://p.mrsu.ru/OAuth/Authorize` |
| Token | `https://p.mrsu.ru/OAuth/Token` |
| User profile | `https://papi.mrsu.ru/v1/User` |

`_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI` — лямбды, читающие env при каждом вызове (не требуют присутствия при импорте).

#### `_short_fio(fio) → str`

«Иванов Иван Иванович» → «Иванов И.И.». Используется в navbar.

#### `GET /auth/login`

Генерирует CSRF-токен `secrets.token_urlsafe(16)`, сохраняет в `session["oauth_state"]`, редирект на EIOS с `prompt=login` (принудительный повторный вход).

#### `GET /signin-eios`

1. Проверяет отсутствие `error` и наличие `code`.
2. Сверяет `state` с `session["oauth_state"]` (CSRF).
3. `POST /Token` — обмен кода на `access_token`.
4. `GET /User` — профиль; проверяет `EIOS_ALLOWED_ROLE`.
5. `upsert_user()`, проверка `is_banned`, запись `session["user"]`.

---

### `app/schemas.py`

**Ответственность:** Pydantic-модели всех входящих API-запросов.

#### Ключевые модели

**`AnalyzeRequest`** — `session_id` + `file_labels` + `file_colors` + `configs: List[ColumnConfig]`.  
`ColumnConfig.file_mapping: Dict[parquet_filename, column_name]` — имя колонки может отличаться между файлами.  
`ColumnConfig.merged_columns` — дополнительные колонки того же файла, счётчики которых суммируются с основным вопросом.

**`ExportQuestion`** — главная модель одного вопроса в отчёте. Ключевые поля:

| Поле | Назначение |
|------|-----------|
| `viz_tab` | `"bar"` / `"pie"` / `"table"` / `"both"` / `"stacked"` / `None` |
| `chart_direction` | `"x"` (вертикальные столбцы) / `"y"` (горизонтальные) |
| `hidden_col` | `"none"` / `"count"` / `"percent"` — скрыть столбец таблицы |
| `skip_analytics` | не запрашивать LLM-текст |
| `section: SectionInfo` | к какому разделу принадлежит вопрос |
| `pie_colors`, `bar_colors`, `file_colors` | цветовые переопределения |

**`ExportDocxRequest`** — `questions` + `session_id` + `title_page_body` + `title_page_approval`.  
**`AiGroupRequest`** — `answers: List[str]` + `question_name`.

---

### `app/data_logic.py`

**Ответственность:** очистка DataFrame после загрузки и агрегация ответов для `/analyze`.

#### `clean_column_name(col_name) → str`

Удаляет числовой префикс `"1. "` / `"2) "` из начала имени столбца и завершающее `:`.

#### `clean_answer_text(answer) → str`

То же для значений ячеек. `pd.isna` → `missing_value_placeholder`. Убирает `"1. "` / `"2) "` в начале строки.

#### `is_system_column(col_name) → bool`

Проверяет по `system_columns_exact` (точное совпадение) и `system_columns_contains` (вхождение подстроки, без учёта регистра). Системные колонки (timestamp, email и т.д.) не предлагаются как вопросы для анализа.

#### `unify_numbered_answers(series) → Series`

Ключевая функция нормализации. Алгоритм:
1. Пытается извлечь паттерн `^\d+[).]\s*(.*)` из каждого значения.
2. Если таких значений достаточно — строит словарь `{номер → канонический текст}`:
   - Берёт наиболее частый текст (mode) для каждого номера.
   - Предпочитает кириллицу при равных частотах.
3. Заменяет все значения серии на канонические.

**Зачем:** разные выгрузки содержат `"1) Да"`, `"1. Да"`, `"1. да"` — это один ответ.

#### `clean_age(age_str) → str`

Нормализует возраст: год рождения > 1900 → текущий год − значение; число → как есть; иначе → `"Нет ответа"`.

#### `clean_dataframe(df) → DataFrame`

Применяет очистку ко всему датафрейму: системные колонки — пропускает; колонки с «возраст»/«лет» → `clean_age`; остальные → `unify_numbered_answers`; переименовывает все столбцы через `clean_column_name`.

#### `get_column_groups(columns) → dict`

Определяет мультивыборные вопросы по разделителю ` / ` в имени столбца.

```
["Хобби / Спорт", "Хобби / Музыка", "Возраст"]
→ {"Хобби": ["Хобби / Спорт", "Хобби / Музыка"], "Возраст": ["Возраст"]}
```

Префикс формирует группу только если таких столбцов > 1.

#### `_get_answer_counts(df, q_name, groups_cache) → dict`

`value_counts` по вопросу. Для мультивыборных — объединяет все связанные столбцы через `melt`. Фильтрует пустые, `nan`, `"Нет ответа"`. Группирует одинаковые ответы после очистки.

#### `generate_report_data(upload_dir, request_data) → list`

Точка входа `/analyze`. Для каждого `ColumnConfig`: считает ответы по основной колонке, суммирует с `merged_columns`, собирает все ответы по всем файлам, сортирует по убыванию суммарного количества.

---

### `app/ai_report.py`

**Ответственность:** нормализация свободных текстовых ответов через LLM (шаг 4 мастера).

#### Зависимости от `docx_gen.py`

`_chat_completion`, `_pace`, `_mark_request_done`, `_backoff_wait` импортированы напрямую — singleton-клиент и управление темпом общие для всего приложения.

#### `_extract_json(text) → dict`

Парсит ответ LLM: 1) `json.loads`; 2) ищет блок ` ```json ... ``` `; 3) иначе `ValueError`.

#### `_build_group_prompt(answers, question_name) → str`

Вставляет пронумерованный список ответов в шаблон `prompt_grouping`. Модель должна вернуть `{"1": "нормализованный", "2": "...", ...}`.

#### `_build_groups_from_norm_map(original_answers, norm_map) → list[dict]`

Принимает список с дубликатами и словарь `{оригинал: канон}`. Строит `[{"canonical": "Россия", "members": ["россия", "РФ", "Россия"]}, ...]`.

#### `_grouping_cache_key(unique_answers, question_name) → str`

MD5 от `{answers, question_name, model, prompt_hash}`. При изменении промпта или модели кэш инвалидируется автоматически.

#### `_normalize_batch(batch_answers, question_name) → dict[str, str]`

Один LLM-вызов на батч. До 6 попыток с backoff при `RateLimitError`. Возвращает `{оригинал: нормализованный}`.

#### `_normalize_in_parallel(batches, question_name, cancel_event) → dict[str, str]`

`ThreadPoolExecutor(max_workers=llm_group_max_concurrency)`. Параллельно нормализует батчи. При ошибке в любом батче — пробрасывает первую (`all-or-nothing`). Проверяет `cancel_event`.

#### `group_answers_llm(answers, question_name, cancel_event) → list[dict]`

Публичная точка входа:
1. Дедупликация: `list(dict.fromkeys(answers_str))`.
2. Проверка кэша по `_grouping_cache_key`.
3. Батчинг по `llm_group_batch_size`.
4. Параллельная нормализация.
5. Сборка групп.
6. Сохранение в кэш.

---

### `app/docx_gen.py`

**Ответственность:** сборка аналитического DOCX + LLM-клиент + управление темпом запросов.

#### Singleton и управление темпом

**`get_gigachat_client() → GigaChat`**  
Один клиент на весь процесс. Пересоздаётся при изменении `gigachat_credentials` в конфиге. Аутентификация — OAuth2 по Authorization key, TLS — по сертификату НУЦ Минцифры (`gigachat_ca_bundle_file`).

**`_chat_completion(messages, max_tokens, temperature) → str`**  
Общая обёртка над `client.chat({...})`, возвращает `response.choices[0].message.content`. Используется и в `docx_gen.py`, и (через импорт) в `ai_report.py`.

**`_pace()`**  
Перед каждым LLM-вызовом: если с предыдущего прошло менее `llm_sleep_between_calls` сек — ждёт остаток. Предотвращает rate-limit при параллельных запросах.

**`_backoff_wait(attempt)`**  
`min(60, 2^(attempt+1) + random(0.5..2.0))` сек. При HTTP 429.

#### Утилиты документа

**`_p(doc, text, ...)`** — абзац Times New Roman 14pt с поддержкой жирного, выравнивания, отступов.

**`_make_doc()`** — документ с полями 2/2/3/1.5 см (верх/низ/лево/право), шрифт Normal — TNR 14pt.

#### Титульный лист

**`_p_inline_bold(doc, line)`** — строка с `**bold**`: `re.split(r"\*\*(.+?)\*\*", line)`, нечётные фрагменты — жирные.

**`_render_approval_stamp(doc, approval_text)`** — невидимая таблица 1×1, ширина 8.5 см, выровнена по правому краю. Первая строка — жирная.

**`_render_title_body(doc, body_text)`** — минимальный Markdown: `# Заголовок` → центрированный жирный, остальное → justified с поддержкой `**bold**`.

**`_render_title_page(...) → bool`** — оркестратор; возвращает `True` если что-то нарисовал (вызывающий добавляет `page_break`).

#### Промпты и LLM

**`_build_question_prompt(question, sec_name, sec_description) → (system, user)`**  
System: роль аналитика + контекст раздела.  
User: пример стиля + правила + статистика ответов с процентами.

**`_call_llm(prompt, system, max_tokens) → str`**  
До 6 попыток с backoff. `_pace()` перед запросом, `_mark_request_done()` после.

#### Параллельная генерация текстов

**`_generate_texts_parallel(questions, ...) → list[dict]`**

Один `threading.Thread` на вопрос. `threading.Semaphore(3)` ограничивает одновременные LLM-вызовы. Каждый воркер:
1. `cancel_event` → `skipped`
2. `skip_analytics=True` → `skipped`
3. Проверка `_analysis_cache` (ключ: данные + промпты + модель)
4. Семафор → `_call_llm` → кэш

Результаты хранятся в `results[idx]` — порядок совпадает с исходным списком вопросов.

#### Выводы по разделам

**`_build_section_conclusion_prompt(sec_name, sec_description, questions_in_section)`**  
Передаёт LLM полную статистику всех вопросов раздела. Требует 3–5 предложений без маркеров/заголовков.

**`_generate_section_conclusions_parallel(sections, ...)`**  
Аналог `_generate_texts_parallel` для разделов. Отдельный кэш `_section_conclusion_cache`.

#### Итоговые выводы

**`_build_final_conclusion_prompt(questions)`**  
Передаёт все вопросы опроса, сгруппированные по разделам. Требует 4–5 абзацев (5–6 предложений) с указанием что ввести/развивать и от чего отказаться.

**`_generate_final_conclusion(questions, ...)`**  
Один LLM-вызов. Кэш `_final_conclusion_cache`.

#### `generate_analysis_docx(questions, ...) → bytes`

Главная функция. Порядок:
1. Титульный лист.
2. Группировка вопросов по разделам (`_group_questions_by_section`).
3. **Три параллельных волны LLM** в отдельных потоках:
   - `_generate_texts_parallel` — тексты вопросов
   - `_generate_section_conclusions_parallel` — выводы разделов
   - `_generate_final_conclusion` — итоговые выводы
4. Сборка документа в исходном порядке вопросов.
5. После последнего вопроса каждого раздела — «Выводы раздела».
6. На новой странице в конце — итоговые выводы.

---

### `app/chart_gen.py`

**Ответственность:** создание редактируемых OOXML-графиков Word путём ручной сборки XML-частей и встраивания в OPC-контейнер `.docx`.

#### Почему не python-docx

`python-docx` не поддерживает графики. График Word — отдельный XML-файл `word/charts/chartN.xml` плюс связанная книга Excel `word/embeddings/sheetN.xlsx`, соединённые через relationships. Собирается вручную через `docx.opc.part.Part` + `PackURI`.

#### EMU (English Metric Units)

Единица измерения OOXML: 1 см = 360 000 EMU. Константы: `TEXT_W` = 16.5 см, `BAR_H` = 10 см, `PIE_H` = 9 см.

#### Вспомогательные функции

**`_x(s)`** — XML-экранирование (`&`, `<`, `>`, `"`). Применяется ко всем данным, вставляемым в XML.

**`_color_hex(c)`** — приводит к OOXML-формату: 6 hex-символов без `#`; поддерживает `#FFF` → `FFFFFF`.

**`_data_labels_block(pos, show_val, show_percent)`** — XML-блок `<c:dLbls>`. Жирный TNR, для столбчатых — абсолютные значения; для круговых — проценты.

**`_values_to_percent_per_series(series_values)`** — счётчики → проценты в пределах каждой серии (как на фронтенде).

**`_build_xlsx(answers, series_labels, series_values) → bytes`** — минимальная Excel-книга с данными графика (openpyxl).

#### Генераторы XML

**`_bar_xml(...) → bytes`** — `<c:chartSpace>` для столбчатой диаграммы.
- `bar_dir="col"` — вертикальные, `"bar"` — горизонтальные
- `stacked=True` → `percentStacked`
- `series_colors` — цвет каждой серии (по файлу)
- `point_colors` — цвет каждого столбика (один файл)
- Легенда внизу с фиксированным положением через `<c:manualLayout>`

**`_pie_xml(...) → bytes`** — `<c:chartSpace>` для круговой. `varyColors="1"`. Цвета секторов через `<c:dPt>`. Проценты вычисляет OOXML из абсолютных значений.

#### `_embed_chart(doc, chart_xml, xlsx, n, cx, cy)`

1. `Part(PackURI('/word/charts/chartN.xml'))` + `doc.part.relate_to(chart_part, RT_CHART)` → `r_id`
2. `Part(PackURI('/word/embeddings/sheetN.xlsx'))` + `chart_part.relate_to(excel_part, RT_PACKAGE)` — всегда становится `rId1` в XML графика
3. Inline drawing XML с `cx`/`cy` вставляется через `lxml.etree.fromstring`

`n` должен быть уникальным в пределах документа — иначе ZIP-конфликт имён файлов.

#### `insert_visualization(doc, q, chart_counter, table_counter, part_counter)`

Диспетчер визуализации:

| `viz_tab` | Результат в документе |
|-----------|----------------------|
| `"table"` | Подпись «Таблица N» + Word-таблица |
| `"bar"` / `"stacked"` | Столбчатый график + «Рисунок N» |
| `"pie"` | По одной круговой на каждый файл + «Рисунок N» |
| `"both"` | Таблица + выбранный тип графика |
| `None` | Ничего |

Нумерация рисунков и таблиц — сквозная по документу. `part_counter` — отдельный счётчик имён ZIP-файлов.

**Особенность `"pie"` + несколько файлов:** отдельная диаграмма на каждый файл, но подпись «Рисунок N» — одна общая.

#### `_insert_word_table(doc, q)`

Word-таблица 100% ширины с рамкой. Поддерживает:
- `hidden_col` — скрытие столбца количества или процентов
- Multi-file — отдельные столбцы кол-во/% на каждый файл
- Строка «Всего» при `show_total=True`
