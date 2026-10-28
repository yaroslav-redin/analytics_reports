"""Клиент API отчётов опросов ЭИОС (papi.mrsu.ru).

Токены хранятся в таблице eios_tokens; access_token обновляется через
refresh_token заранее (за минуту до истечения) или после ответа 401.
"""
import asyncio
import os
import time

import httpx

from app.database import get_eios_tokens, save_eios_tokens, delete_eios_tokens
from app.eios_data import build_report_request, clean_metadata
from app.schemas import EiosCohort

api_base = lambda: os.getenv("EIOS_API_BASE", "https://papi.mrsu.ru").rstrip("/")
token_url = lambda: os.getenv("EIOS_OAUTH_BASE", "https://p.mrsu.ru").rstrip("/") + "/OAuth/Token"
_TIMEOUT = lambda: float(os.getenv("EIOS_API_TIMEOUT", "120"))
_VERIFY_TLS = lambda: os.getenv("EIOS_API_VERIFY_TLS", "true").lower() != "false"

_REFRESH_MARGIN_SECONDS = 60
_REPORT_CONCURRENCY = 2   # параллельных POST /v1/poolreport на одну сборку
_METADATA_TTL_SECONDS = 3 * 3600
_MSG_RELOGIN = "Сессия ЭИОС истекла или не выдан доступ к отчётам. Войдите заново."

_transport: httpx.AsyncBaseTransport | None = None   # подменяется в тестах
_refresh_locks: dict[str, asyncio.Lock] = {}
_metadata_cache: dict[tuple[str, int], tuple[float, dict]] = {}


class EiosApiError(Exception):
    status_code = 502
    code = "eios_error"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class EiosAuthRequired(EiosApiError):
    status_code = 401
    code = "auth_required"


class EiosForbidden(EiosApiError):
    status_code = 403
    code = "forbidden"


class EiosBadRequest(EiosApiError):
    status_code = 400
    code = "bad_request"


class EiosNotFound(EiosApiError):
    status_code = 404
    code = "not_found"


def _client(**kwargs) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=_TIMEOUT(), verify=_VERIFY_TLS(), transport=_transport, **kwargs)


def tokens_from_response(data: dict) -> dict:
    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token") or "",
        "expires_at": time.time() + float(data.get("expires_in") or 3600),
    }


async def _refresh(user_id: str, refresh_token: str) -> dict:
    if not refresh_token:
        await delete_eios_tokens(user_id)
        raise EiosAuthRequired(_MSG_RELOGIN)
    try:
        async with _client() as client:
            resp = await client.post(
                token_url(),
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": os.getenv("EIOS_CLIENT_ID", ""),
                    "client_secret": os.getenv("EIOS_CLIENT_SECRET", ""),
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except httpx.HTTPError:
        raise EiosApiError("Не удалось связаться с порталом ЭИОС для обновления входа.")
    if resp.status_code != 200:
        await delete_eios_tokens(user_id)
        raise EiosAuthRequired(_MSG_RELOGIN)
    tokens = tokens_from_response(resp.json())
    if not tokens["refresh_token"]:
        tokens["refresh_token"] = refresh_token
    await save_eios_tokens(user_id, **tokens)
    return tokens


async def get_access_token(user_id: str, stale_token: str | None = None) -> str:
    """Возвращает живой access_token. stale_token — токен, на который API ответил 401:
    обновляем, только если в БД всё ещё он (иначе его уже обновил параллельный запрос)."""
    lock = _refresh_locks.setdefault(user_id, asyncio.Lock())
    async with lock:
        tokens = await get_eios_tokens(user_id)
        if tokens is None:
            raise EiosAuthRequired(_MSG_RELOGIN)
        expiring = tokens["expires_at"] - time.time() < _REFRESH_MARGIN_SECONDS
        rejected = stale_token is not None and tokens["access_token"] == stale_token
        if expiring or rejected:
            tokens = await _refresh(user_id, tokens["refresh_token"])
        return tokens["access_token"]


async def _send(method: str, path: str, token: str, **kwargs) -> httpx.Response:
    try:
        async with _client(base_url=api_base()) as client:
            return await client.request(
                method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs,
            )
    except httpx.TimeoutException:
        raise EiosApiError("ЭИОС не ответил вовремя. Попробуйте позже или сузьте выборку.")
    except httpx.HTTPError:
        raise EiosApiError("Не удалось связаться с ЭИОС.")


def _error_text(resp: httpx.Response) -> str:
    try:
        data = resp.json()
    except ValueError:
        return resp.text.strip()[:500]
    if isinstance(data, dict):
        for key in ("Message", "message", "error_description", "error"):
            if data.get(key):
                return str(data[key])[:500]
    if isinstance(data, str):
        return data[:500]
    return resp.text.strip()[:500]


def _parse(resp: httpx.Response):
    if resp.status_code == 200:
        try:
            return resp.json()
        except ValueError:
            raise EiosApiError("ЭИОС вернул некорректный ответ.")
    if resp.status_code == 401:
        raise EiosAuthRequired(_MSG_RELOGIN)
    if resp.status_code == 403:
        raise EiosForbidden("Нет доступа к этому отчёту. Доступ выдаёт владелец опроса.")
    if resp.status_code == 400:
        raise EiosBadRequest(_error_text(resp) or "ЭИОС отклонил запрос отчёта.")
    if resp.status_code == 404:
        raise EiosNotFound("Опрос не найден в ЭИОС.")
    raise EiosApiError(f"ЭИОС вернул ошибку {resp.status_code}. Попробуйте позже.")


async def _request(user_id: str, method: str, path: str, **kwargs):
    token = await get_access_token(user_id)
    resp = await _send(method, path, token, **kwargs)
    if resp.status_code == 401:
        token = await get_access_token(user_id, stale_token=token)
        resp = await _send(method, path, token, **kwargs)
    return _parse(resp)


async def list_reports(user_id: str) -> list[dict]:
    return await _request(user_id, "GET", "/v1/poolreport") or []


async def get_metadata(user_id: str, profile_id: int) -> dict:
    key = (user_id, profile_id)
    cached = _metadata_cache.get(key)
    if cached and time.time() - cached[0] < _METADATA_TTL_SECONDS:
        return cached[1]
    data = clean_metadata(await _request(user_id, "GET", "/v1/poolreportmetadata", params={"profileId": profile_id}))
    _metadata_cache[key] = (time.time(), data)
    return data


async def get_report(user_id: str, body: dict) -> dict:
    return await _request(user_id, "POST", "/v1/poolreport", json=body)


async def fetch_cohorts(user_id: str, cohorts: list[EiosCohort]) -> tuple[dict[int, dict], list[dict]]:
    """Справочники опросов когорт (по profile_id) и отчёты в порядке когорт.
    При нескольких опросах ошибка ЭИОС получает префикс с названием опроса."""
    profile_ids = list(dict.fromkeys(c.profile_id for c in cohorts))
    metas: dict[int, dict] = {}
    sem = asyncio.Semaphore(_REPORT_CONCURRENCY)

    async def named(pid: int, coro):
        try:
            return await coro
        except EiosApiError as exc:
            if len(profile_ids) == 1:
                raise
            title = (metas.get(pid) or {}).get("Title") or f"Опрос {pid}"
            raise type(exc)(f"«{title}»: {exc.message}") from exc

    async def meta(pid: int):
        metas[pid] = await named(pid, get_metadata(user_id, pid))

    async def report(cohort: EiosCohort):
        async with sem:
            body = build_report_request(cohort.profile_id, cohort.filters)
            return await named(cohort.profile_id, get_report(user_id, body))

    await asyncio.gather(*(meta(pid) for pid in profile_ids))
    reports = await asyncio.gather(*(report(c) for c in cohorts))
    return metas, list(reports)
