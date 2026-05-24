# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Команды для разработки

```powershell
# Активировать venv и запустить сервер разработки (порт 64548 зарегистрирован в EIOS OAuth)
.\venv\Scripts\activate
uvicorn app.main:app --reload --port 64548
```

Тестовый набор отсутствует — тестирование производится вручную через браузер. Файл `.env` должен быть заполнен (см. `.env.example`) до запуска: без ключей OAuth-вход и LLM-вызовы не работают.

## Архитектура

FastAPI-приложение для отдела анкетирования МГУ им. Огарёва. Пользователи загружают выгрузки опросов в Excel/CSV, настраивают визуализации и экспортируют аннотированные ИИ отчёты в Word.

### Жизненный цикл запроса

Состояние браузера хранится в `window.appData` (JS). 6-шаговый мастер отправляет POST-запросы к эндпоинтам в следующем порядке:

1. `POST /upload` — сохраняет файлы в `uploads/{session_id}/`, удаляет предыдущие сессии пользователя
2. `POST /process_sheets` — очищает DataFrame, сохраняет как Parquet в папку сессии
3. `POST /analyze` — читает Parquet, агрегирует счётчики ответов, возвращает JSON
4. `POST /ai_group_answers` — LLM нормализует свободные ответы (OpenRouter)
5. `POST /export_docx_start` — запускает фоновый поток генерации, возвращает `task_id`
6. `GET /export_docx_stream/{task_id}` — SSE-подписка на прогресс; клиент получает snapshot + live-обновления
7. `POST /export_docx_cancel/{task_id}` — запрашивает отмену через `threading.Event`

Файлы сессии автоматически удаляются через 6 часов фоновым asyncio-циклом в `app/main.py`.

### ExportTask — менеджер фоновых задач

`ExportTask` (в `app/main.py`) — это объект, живущий в памяти процесса (`_export_tasks: dict[str, ExportTask]`). Генерация docx идёт в `threading.Thread`, а SSE-клиенты подписываются через `asyncio.Queue`. Метод `_emit()` атомарно (через `threading.Lock`) обновляет статус и уведомляет все подписанные очереди через `loop.call_soon_threadsafe`. Это позволяет множеству вкладок браузера одновременно наблюдать одну задачу. Задачи чистятся через час после завершения.

### Ключевые модули

| Файл | Роль |
|------|------|
| `app/main.py` | FastAPI-приложение, lifespan (инициализация БД + цикл очистки), все HTTP-эндпоинты, `ExportTask` |
| `app/auth.py` | OAuth 2.0 через EIOS (p.mrsu.ru); пользователь хранится в Starlette session cookie |
| `app/config.py` | Настройки: in-memory кэш поверх таблицы SQLite `settings`; `await cfg.load(db_path)` при старте |
| `app/data_logic.py` | Очистка DataFrame (удаление числовых префиксов, нормализация возраста, определение системных столбцов) и агрегация ответов |
| `app/ai_report.py` | Группировка ответов через LLM: дедупликация → батчинг (50/батч) → параллельный ThreadPoolExecutor (макс. 3) → in-memory кэш по хэшу содержимого |
| `app/docx_gen.py` | Экспорт в Word: параллельный LLM-анализ (ThreadPoolExecutor + семафор) → OOXML-графики → один выходной файл (аналитика); содержит singleton OpenRouter клиент, `_pace()` и `_backoff_wait()` для rate limit |
| `app/chart_gen.py` | Строит редактируемые OOXML-графики (столбчатые/круговые/таблицы), встроенные в .docx со связанными данными Excel |
| `app/database.py` | Прямые aiosqlite-запросы; таблицы: `settings`, `users`, `upload_sessions`, `generated_reports` |
| `app/schemas.py` | Pydantic-модели запросов и ответов |

### Фронтенд

Шаблоны — Jinja2 (`app/templates/`, партиалы в `partials/`). JS-модули находятся в `app/static/js/modules/`:

| Файл | Роль |
|------|------|
| `state.js` | Единственный источник истины — `window.appData`; мутации и геттеры |
| `wizard.js` | Оркестратор мастера: переключение шагов, валидация, навигация |
| `upload.js` | Шаг 1: загрузка файлов |
| `sheets.js` | Шаг 2: выбор листов |
| `questions.js` | Шаг 3: конфигурация вопросов |
| `step4.js` | Шаг 4: предпросмотр аналитики |
| `step5.js` | Шаг 5: настройка заголовков и разделов |
| `step6.js` | Шаг 6: генерация и скачивание отчёта (SSE-клиент к `/export_docx_stream`) |
| `charts.js` | Рендеринг Chart.js для предпросмотра |
| `fuzzy.js` | Нечёткий поиск для Select2 |
| `utils.js` | Общие утилиты |

Используются Bootstrap 5, Chart.js, Select2, Sortable.js. Сборка не требуется — все ресурсы раздаются напрямую.

### Интеграция с LLM

`docx_gen.py` содержит singleton `OpenAI`-клиент (`get_openrouter_client()`), функции `_pace()` (адаптивная пауза между запросами) и `_backoff_wait()` (экспоненциальный backoff при HTTP 429). Эти функции импортируются в `ai_report.py`. Результаты кэшируются in-memory на время жизни процесса (сбрасываются при перезапуске). Промпты хранятся в таблице `settings` БД и редактируются через `/settings`.

### Встраивание OOXML-графиков

`chart_gen.py` создаёт настоящие редактируемые графики Word (не изображения), вручную собирая OOXML-части и связывая каждый график со встроенной книгой Excel внутри OPC-контейнера `.docx`. Именно поэтому одного `python-docx` недостаточно — части графиков строятся и вставляются напрямую.

### Конфигурация

Все настраиваемые параметры (модель LLM, температуры, промпты, палитры цветов, списки системных столбцов) берутся из `app/config.py` через таблицу `settings` БД. Доступ: `cfg.get(key)`, `cfg.get_int(key)`, `cfg.get_json(key)`. Значения по умолчанию — в `config.DEFAULTS`.

### Внешние зависимости

- **EIOS OAuth** — университетский SSO на `https://p.mrsu.ru`; захардкожен в `auth.py`
- **OpenRouter** — LLM API; по умолчанию `meta-llama/llama-3.3-70b-instruct:free`
- **SQLite** — `survey_analytics.db` (путь переопределяется через `$DB_PATH`)
