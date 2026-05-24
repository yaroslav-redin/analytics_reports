import os
import secrets
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, JSONResponse
from urllib.parse import urlencode
from app.database import upsert_user

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

_AUTH_URL = "https://p.mrsu.ru/OAuth/Authorize"
_TOKEN_URL = "https://p.mrsu.ru/OAuth/Token"
_USER_URL = "https://papi.mrsu.ru/v1/User"
_SCOPE = "base"


@router.get("/auth/login")
async def login(request: Request):
    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state
    params = urlencode({
        "response_type": "code",
        "client_id": _CLIENT_ID(),
        "redirect_uri": _REDIRECT_URI(),
        "scope": _SCOPE,
        "state": state,
        "prompt": "login",
    })
    return RedirectResponse(f"{_AUTH_URL}?{params}")


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
                _TOKEN_URL,
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
                _USER_URL,
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
    request.session["user"] = user_data
    return RedirectResponse("/")


@router.get("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login")


@router.get("/auth/me")
async def me(request: Request):
    user = request.session.get("user")
    if not user:
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return user
