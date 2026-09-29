import os
import secrets
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, JSONResponse
from urllib.parse import urlencode, quote
from app.database import upsert_user, save_eios_tokens, delete_eios_tokens
from app.eios_api import tokens_from_response, token_url, api_base

router = APIRouter()


def _short_fio(fio: str) -> str:
    parts = fio.strip().split()
    if len(parts) <= 1:
        return fio
    result = parts[0]
    for part in parts[1:]:
        if part:
            result += f" {part[0]}."
    return result


_CLIENT_ID = lambda: os.getenv("EIOS_CLIENT_ID", "")
_CLIENT_SECRET = lambda: os.getenv("EIOS_CLIENT_SECRET", "")
_REDIRECT_URI = lambda: os.getenv("EIOS_REDIRECT_URI", "http://localhost:64548/signin-eios")

_OAUTH_BASE = lambda: os.getenv("EIOS_OAUTH_BASE", "https://p.mrsu.ru").rstrip("/")
_SCOPE = lambda: os.getenv("EIOS_SCOPE", "base pool_report")


def build_authorize_url(state: str, reconsent: bool = False) -> str:
    params = {
        "response_type": "code",
        "client_id": _CLIENT_ID(),
        "redirect_uri": _REDIRECT_URI(),
        "scope": _SCOPE(),
        "state": state,
        "prompt": "login",
    }
    # force_confirm=1 заставляет портал заново показать экран согласия —
    # нужно, если старый токен был выдан без scope pool_report.
    if reconsent:
        params["force_confirm"] = "1"
    # quote вместо quote_plus: пробел в scope кодируется как %20, как требует ЭИОС.
    return f"{_OAUTH_BASE()}/OAuth/Authorize?{urlencode(params, quote_via=quote)}"


@router.get("/auth/login")
async def login(request: Request):
    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state
    reconsent = request.query_params.get("reconsent") == "1"
    return RedirectResponse(build_authorize_url(state, reconsent=reconsent))


@router.get("/signin-eios")
async def auth_callback(request: Request):
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    error = request.query_params.get("error")

    if error or not code:
        return RedirectResponse("/login?error=auth_failed")

    stored_state = request.session.pop("oauth_state", None)
    if not state or state != stored_state:
        return RedirectResponse("/login?error=csrf")

    try:
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                token_url(),
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": _REDIRECT_URI(),
                    "client_id": _CLIENT_ID(),
                    "client_secret": _CLIENT_SECRET(),
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=15.0,
            )
            token_resp.raise_for_status()
            tokens = token_resp.json()

            user_resp = await client.get(
                f"{api_base()}/v1/User",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
                timeout=10.0,
            )
            user_resp.raise_for_status()
            user = user_resp.json()
    except Exception as exc:
        return RedirectResponse(f"/login?error=token_failed")

    user_roles = [r["Name"] for r in user.get("Roles", [])]

    allowed_role = os.getenv("EIOS_ALLOWED_ROLE", "")
    if allowed_role and allowed_role not in user_roles:
        return RedirectResponse("/login?error=access_denied")

    user_data = {
        "id": user["Id"],
        "fio": user["FIO"],
        "short_fio": _short_fio(user["FIO"]),
        "email": user["Email"],
        "username": user.get("UserName", ""),
        "roles": user_roles,
        "photo_url": (user.get("Photo") or {}).get("UrlSmall", ""),
    }
    flags = await upsert_user(user_data)
    if flags["is_banned"]:
        return RedirectResponse("/login?error=banned")
    user_data["is_admin"] = flags["is_admin"]
    # Токены — только на сервере: session cookie подписана, но не зашифрована.
    await save_eios_tokens(user["Id"], **tokens_from_response(tokens))
    request.session["user"] = user_data
    return RedirectResponse("/")


@router.get("/auth/logout")
async def logout(request: Request):
    user = request.session.get("user")
    if user:
        await delete_eios_tokens(user["id"])
    request.session.clear()
    return RedirectResponse("/login")


@router.get("/auth/me")
async def me(request: Request):
    user = request.session.get("user")
    if not user:
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return user
