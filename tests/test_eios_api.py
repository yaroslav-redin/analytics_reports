import asyncio
import json
import time

import httpx
import pytest

from app import database, eios_api
from tests.eios_samples import cohort, sample_meta, sample_report

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


class MultiSurveyEios:
    """Имитация papi с несколькими опросами: справочник и отчёт по profile_id."""

    def __init__(self):
        self.meta_calls = []
        self.report_profile_ids = []
        self.fail_meta = {}       # profile_id → HTTP-статус
        self.fail_report = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/poolreportmetadata":
            pid = int(request.url.params["profileId"])
            self.meta_calls.append(pid)
            if pid in self.fail_meta:
                return httpx.Response(self.fail_meta[pid])
            return httpx.Response(200, json=sample_meta(profile_id=pid, title=f"Опрос-{pid}"))
        pid = json.loads(request.content)["TestProfileId"]
        self.report_profile_ids.append(pid)
        if pid in self.fail_report:
            return httpx.Response(self.fail_report[pid])
        return httpx.Response(200, json=sample_report())


@pytest.fixture
async def multi(db, monkeypatch):
    m = MultiSurveyEios()
    monkeypatch.setattr(eios_api, "_transport", httpx.MockTransport(m.handler))
    eios_api._refresh_locks.clear()
    eios_api._metadata_cache.clear()
    await _store()
    return m


async def test_fetch_cohorts_metadata_once_per_survey(multi):
    metas, reports = await eios_api.fetch_cohorts(
        "u1", [cohort("a", profile_id=1), cohort("b", profile_id=1), cohort("c", profile_id=2)])
    assert set(metas) == {1, 2}
    assert sorted(multi.meta_calls) == [1, 2]
    assert sorted(multi.report_profile_ids) == [1, 1, 2]   # порядок запросов не гарантирован семафором
    assert len(reports) == 3


async def test_fetch_cohorts_error_names_survey(multi):
    multi.fail_report[2] = 403
    with pytest.raises(eios_api.EiosForbidden) as e:
        await eios_api.fetch_cohorts("u1", [cohort("a", profile_id=1), cohort("c", profile_id=2)])
    assert e.value.message.startswith("«Опрос-2»: ")


async def test_fetch_cohorts_single_survey_message_unchanged(multi):
    multi.fail_report[1] = 403
    with pytest.raises(eios_api.EiosForbidden) as e:
        await eios_api.fetch_cohorts("u1", [cohort("a", profile_id=1)])
    assert e.value.message == "Нет доступа к этому отчёту. Доступ выдаёт владелец опроса."


async def test_fetch_cohorts_metadata_error_uses_id(multi):
    multi.fail_meta[2] = 404
    with pytest.raises(eios_api.EiosNotFound) as e:
        await eios_api.fetch_cohorts("u1", [cohort("a", profile_id=1), cohort("c", profile_id=2)])
    assert e.value.message.startswith("«Опрос 2»: ")


def _session_cookie(user: dict) -> str:
    """Cookie в формате starlette SessionMiddleware (секрет — из conftest)."""
    from base64 import b64encode
    from itsdangerous import TimestampSigner
    return TimestampSigner("test-secret").sign(b64encode(json.dumps({"user": user}).encode())).decode()


async def _post_build(cohorts: list[dict]) -> httpx.Response:
    from app import main
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://test",
        cookies={"session": _session_cookie({"id": "u1"})},
    ) as client:
        return await client.post("/eios/build_session", json={"cohorts": cohorts})


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    from app import main
    path = tmp_path / "uploads"
    path.mkdir()
    monkeypatch.setattr(main, "UPLOAD_DIR", str(path))
    return path


async def test_build_session_error_keeps_existing_session(multi, uploads):
    (uploads / "old").mkdir()
    await database.log_upload_session("old", "u1", [])
    multi.fail_report[2] = 403
    resp = await _post_build([{"profile_id": 1, "label": "a"}, {"profile_id": 2, "label": "c"}])
    assert resp.status_code == 403
    assert resp.json()["message"].startswith("«Опрос-2»: ")
    assert [p.name for p in uploads.iterdir()] == ["old"]
    assert await database.pop_user_sessions("u1") == ["old"]


async def test_build_session_two_surveys(multi, uploads):
    resp = await _post_build([{"profile_id": 1, "label": "a"}, {"profile_id": 2, "label": "c"}])
    assert resp.status_code == 200
    data = resp.json()
    assert sorted(data["survey_titles"]) == ["Опрос-1", "Опрос-2"]
    assert [p["label"] for p in data["processed_files"]] == ["a", "c"]
    assert (uploads / data["session_id"] / "eios_cohort_1.json").exists()
