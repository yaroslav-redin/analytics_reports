import os
import sys
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("SESSION_SECRET_KEY", "test-secret")
os.environ.setdefault("EIOS_CLIENT_ID", "test-client")
os.environ.setdefault("EIOS_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("EIOS_REDIRECT_URI", "http://localhost:64548/signin-eios")


@pytest.fixture
async def db(tmp_path, monkeypatch):
    from app import database
    path = str(tmp_path / "test.db")
    monkeypatch.setattr(database, "DB_PATH", path)
    await database.init_db()
    return path
