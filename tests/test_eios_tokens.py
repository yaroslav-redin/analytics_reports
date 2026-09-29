from app import database, auth


async def test_get_missing_tokens_returns_none(db):
    assert await database.get_eios_tokens("nobody") is None


async def test_save_and_get_tokens(db):
    await database.save_eios_tokens("u1", access_token="a", refresh_token="r", expires_at=100.5)
    assert await database.get_eios_tokens("u1") == {
        "access_token": "a", "refresh_token": "r", "expires_at": 100.5,
    }


async def test_save_overwrites_previous_tokens(db):
    await database.save_eios_tokens("u1", access_token="a", refresh_token="r", expires_at=1.0)
    await database.save_eios_tokens("u1", access_token="b", refresh_token="r2", expires_at=2.0)
    assert (await database.get_eios_tokens("u1"))["access_token"] == "b"


async def test_delete_tokens(db):
    await database.save_eios_tokens("u1", access_token="a", refresh_token="r", expires_at=1.0)
    await database.delete_eios_tokens("u1")
    assert await database.get_eios_tokens("u1") is None


def test_authorize_url_requests_pool_report_scope_with_percent20():
    url = auth.build_authorize_url("st")
    assert url.startswith("https://p.mrsu.ru/OAuth/Authorize?")
    assert "scope=base%20pool_report" in url
    assert "state=st" in url
    assert "force_confirm" not in url


def test_reconsent_adds_force_confirm():
    assert "force_confirm=1" in auth.build_authorize_url("st", reconsent=True)
