import aiosqlite
import json
import os
from typing import Optional

DB_PATH = os.getenv("DB_PATH", "survey_analytics.db")

_CREATE_TABLES = """
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id        TEXT PRIMARY KEY,
    email     TEXT,
    fio       TEXT,
    short_fio TEXT,
    username  TEXT,
    roles     TEXT,
    photo_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
);

CREATE TABLE IF NOT EXISTS upload_sessions (
    session_id TEXT PRIMARY KEY,
    user_id    TEXT,
    files      TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS generated_reports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT,
    user_id        TEXT,
    filename       TEXT,
    question_count INTEGER,
    generated_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
);
"""


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_CREATE_TABLES)
        await db.commit()


async def upsert_user(user: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO users (id, email, fio, short_fio, username, roles, photo_url, last_login)
            VALUES (:id, :email, :fio, :short_fio, :username, :roles, :photo_url, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                email      = excluded.email,
                fio        = excluded.fio,
                short_fio  = excluded.short_fio,
                username   = excluded.username,
                roles      = excluded.roles,
                photo_url  = excluded.photo_url,
                last_login = datetime('now')
            """,
            {
                "id":        user["id"],
                "email":     user.get("email", ""),
                "fio":       user.get("fio", ""),
                "short_fio": user.get("short_fio", ""),
                "username":  user.get("username", ""),
                "roles":     json.dumps(user.get("roles", []), ensure_ascii=False),
                "photo_url": user.get("photo_url", ""),
            },
        )
        await db.commit()


async def log_upload_session(session_id: str, user_id: Optional[str], files: list):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO upload_sessions (session_id, user_id, files) VALUES (?, ?, ?)",
            (session_id, user_id, json.dumps(files, ensure_ascii=False)),
        )
        await db.commit()


async def log_generated_report(
    session_id: Optional[str],
    user_id: Optional[str],
    filename: str,
    question_count: int,
):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO generated_reports (session_id, user_id, filename, question_count)"
            " VALUES (?, ?, ?, ?)",
            (session_id, user_id, filename, question_count),
        )
        await db.commit()


async def get_all_users() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, fio, short_fio, email, username, roles, photo_url, created_at, last_login"
            " FROM users ORDER BY last_login DESC"
        ) as cursor:
            rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def cleanup_old_records(session_max_age_hours: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM upload_sessions"
            " WHERE created_at < datetime('now', ? || ' hours')",
            (f"-{session_max_age_hours}",),
        )
        await db.execute(
            "DELETE FROM generated_reports"
            " WHERE generated_at < datetime('now', '-30 days')",
        )
        await db.commit()
