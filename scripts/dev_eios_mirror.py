"""Локальная проверка нескольких опросов ЭИОС, когда реальный отчёт доступен только один.

Запускает приложение на порту 64548 с подменённым транспортом ЭИОС:
вход и реальные отчёты идут в ЭИОС как обычно, а в список опросов добавляются
«копия» каждого реального отчёта (те же данные под другим id — вопросы совпадают)
и синтетический опрос из tests/eios_samples.py (другие вопросы).

Только для локальной разработки — на сервер не разворачивать.

    venv/Scripts/python scripts/dev_eios_mirror.py
"""
import json
import pathlib
import sys

import httpx
import uvicorn

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import eios_api  # noqa: E402
from app.main import app  # noqa: E402
from tests.eios_samples import sample_meta, sample_report  # noqa: E402

COPY_OFFSET = 900_000_000
SYNTH_ID = 999_000_001
SYNTH_TITLE = "Синтетический опрос (dev)"


def _json(data) -> httpx.Response:
    return httpx.Response(200, json=data)


class MirrorTransport(httpx.AsyncBaseTransport):
    def __init__(self):
        self._real = httpx.AsyncHTTPTransport(verify=eios_api._VERIFY_TLS())

    async def _forward(self, request: httpx.Request) -> httpx.Response:
        resp = await self._real.handle_async_request(request)
        await resp.aread()
        return resp

    def _rebuild(self, request: httpx.Request, **kwargs) -> httpx.Request:
        headers = {k: v for k, v in request.headers.items() if k.lower() != "content-length"}
        return httpx.Request(request.method, kwargs.pop("url", request.url), headers=headers, **kwargs)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/poolreport" and request.method == "GET":
            resp = await self._forward(request)
            if resp.status_code != 200:
                return resp
            reports = resp.json() or []
            copies = [{**r, "Id": r["Id"] + COPY_OFFSET, "SurveyName": f"{r.get('SurveyName') or r['Id']} (копия)"}
                      for r in reports]
            return _json(reports + copies + [{"Id": SYNTH_ID, "SurveyName": SYNTH_TITLE, "IsSummable": True}])

        if path == "/v1/poolreportmetadata":
            pid = int(request.url.params["profileId"])
            if pid == SYNTH_ID:
                return _json(sample_meta(profile_id=SYNTH_ID, title=SYNTH_TITLE))
            if pid > COPY_OFFSET:
                url = request.url.copy_set_param("profileId", str(pid - COPY_OFFSET))
                resp = await self._forward(self._rebuild(request, url=url))
                if resp.status_code != 200:
                    return resp
                meta = resp.json()
                meta["TestProfileId"] = pid
                meta["Title"] = f"{meta.get('Title') or pid} (копия)"
                return _json(meta)

        if path == "/v1/poolreport" and request.method == "POST":
            body = json.loads(request.content)
            pid = body.get("TestProfileId")
            if pid == SYNTH_ID:
                return _json(sample_report())
            if pid and pid > COPY_OFFSET:
                body["TestProfileId"] = pid - COPY_OFFSET
                return await self._forward(self._rebuild(request, json=body))

        return await self._forward(request)


if __name__ == "__main__":
    eios_api._transport = MirrorTransport()
    # Объект приложения, а не строка импорта и без --reload: подмена транспорта живёт в этом процессе.
    uvicorn.run(app, host="127.0.0.1", port=64548)
