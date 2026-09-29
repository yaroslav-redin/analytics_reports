import asyncio
import time

import httpx
import pytest

from app import database, eios_api

TOKEN_URL = "https://p.mrsu.ru/OAuth/Token"


class FakeEios:
    """Имитация портала и papi: токен-эндпоинт + API данных."""

    def __init__(self):
        self.token_calls = 0
        self.api_calls = []           # (method, path, authorization)
        self.valid_tokens = {"good"}
        self.refresh_ok = True
        self.api_status = 200
        self.api_body = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URL:
            self.token_calls += 1
            if not self.refresh_ok:
                return httpx.Response(400, json={"error": "invalid_grant"})
            new = f"fresh{self.token_calls}"
            self.valid_tokens.add(new)
            return httpx.Response(200, json={
                "access_token": new, "refresh_token": f"r{self.token_calls}", "expires_in": 3600,
            })
        auth = request.headers.get("Authorization", "")
        self.api_calls.append((request.method, request.url.path, auth))
        if auth.removeprefix("Bearer ") not in self.valid_tokens:
            return httpx.Response(401)
        if isinstance(self.api_body, (list, dict)):
            return httpx.Response(self.api_status, json=self.api_body)
        return httpx.Response(self.api_status, text=self.api_body)


@pytest.fixture
def fake(db, monkeypatch):
    f = FakeEios()
    monkeypatch.setattr(eios_api, "_transport", httpx.MockTransport(f.handler))
    eios_api._refresh_locks.clear()
    eios_api._metadata_cache.clear()
    return f


async def _store(access="good", refresh="r0", ttl=3600):
    await database.save_eios_tokens(
        "u1", access_token=access, refresh_token=refresh, expires_at=time.time() + ttl,
    )


async def test_list_reports_sends_bearer_header(fake):
    await _store()
    fake.api_body = [{"Id": 1, "SurveyName": "Опрос", "IsSummable": True}]
    assert await eios_api.list_reports("u1") == fake.api_body
    assert fake.api_calls == [("GET", "/v1/poolreport", "Bearer good")]


async def test_no_tokens_requires_auth(fake):
    with pytest.raises(eios_api.EiosAuthRequired):
        await eios_api.list_reports("u1")
    assert fake.api_calls == []


async def test_expiring_token_refreshed_before_request(fake):
    await _store(access="stale", ttl=10)
    await eios_api.list_reports("u1")
    assert fake.token_calls == 1
    assert fake.api_calls[-1][2] == "Bearer fresh1"
    stored = await database.get_eios_tokens("u1")
    assert stored["access_token"] == "fresh1"
    assert stored["refresh_token"] == "r1"


async def test_401_refreshes_once_and_retries(fake):
    await _store(access="revoked")
    await eios_api.list_reports("u1")
    assert fake.token_calls == 1
    assert [c[2] for c in fake.api_calls] == ["Bearer revoked", "Bearer fresh1"]


async def test_refresh_failure_deletes_tokens(fake):
    await _store(access="stale", ttl=10)
    fake.refresh_ok = False
    with pytest.raises(eios_api.EiosAuthRequired):
        await eios_api.list_reports("u1")
    assert await database.get_eios_tokens("u1") is None


async def test_concurrent_requests_refresh_once(fake):
    await _store(access="stale", ttl=10)
    await asyncio.gather(eios_api.list_reports("u1"), eios_api.list_reports("u1"))
    assert fake.token_calls == 1


@pytest.mark.parametrize("status, exc", [
    (400, eios_api.EiosBadRequest),
    (403, eios_api.EiosForbidden),
    (404, eios_api.EiosNotFound),
])
async def test_error_mapping(fake, status, exc):
    await _store()
    fake.api_status = status
    fake.api_body = "причина"
    with pytest.raises(exc):
        await eios_api.get_report("u1", {"TestProfileId": 1, "Audience": 0})


async def test_server_error_is_generic_eios_error(fake):
    await _store()
    fake.api_status = 500
    fake.api_body = "boom"
    with pytest.raises(eios_api.EiosApiError) as e:
        await eios_api.get_report("u1", {"TestProfileId": 1, "Audience": 0})
    assert type(e.value) is eios_api.EiosApiError


async def test_bad_request_keeps_reason_from_body(fake):
    await _store()
    fake.api_status = 400
    fake.api_body = {"Message": "Больше 3 условий"}
    with pytest.raises(eios_api.EiosBadRequest) as e:
        await eios_api.get_report("u1", {"TestProfileId": 1, "Audience": 0})
    assert "Больше 3 условий" in e.value.message


async def test_timeout_maps_to_eios_error(fake, monkeypatch):
    await _store()

    def boom(request):
        raise httpx.ReadTimeout("timeout", request=request)

    monkeypatch.setattr(eios_api, "_transport", httpx.MockTransport(boom))
    with pytest.raises(eios_api.EiosApiError) as e:
        await eios_api.list_reports("u1")
    assert "вовремя" in e.value.message


async def test_metadata_is_cached_per_user_and_profile(fake):
    await _store()
    fake.api_body = {"TestProfileId": 5, "Questions": []}
    await eios_api.get_metadata("u1", 5)
    await eios_api.get_metadata("u1", 5)
    assert len(fake.api_calls) == 1
    assert fake.api_calls[0][1] == "/v1/poolreportmetadata"


def test_tokens_from_response_defaults():
    t = eios_api.tokens_from_response({"access_token": "a"})
    assert t["refresh_token"] == ""
    assert t["expires_at"] > time.time() + 3000
