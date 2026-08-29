"""HTTP surface every runtime container serves.

The routes are the adapter contract one to one, so the orchestrator talks to
Wan, Qwen and MuseTalk through identical calls and swapping a model never
changes the caller.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .contract import Capabilities, GenerateRequest, GenerateResult, HealthReport, ModelAdapter
from .security import ReplayGuard, body_hash, verify_envelope

log = logging.getLogger("videoai.worker")


def create_app(adapter: ModelAdapter) -> FastAPI:
    app = FastAPI(title=f"videoai-{adapter.runtime}", docs_url=None, redoc_url=None)
    guard = ReplayGuard()
    signing_key = os.environ.get("GPU_GATEWAY_SIGNING_KEY", "")
    if not signing_key:
        raise RuntimeError("GPU_GATEWAY_SIGNING_KEY is required; the worker refuses unsigned work")

    # Results are kept per job id so a retried request returns the original
    # output instead of spending GPU time again (spec section 48).
    completed: dict[str, GenerateResult] = {}
    in_flight: dict[str, asyncio.Task[GenerateResult]] = {}

    async def authorize(request: Request) -> dict[str, Any]:
        raw = await request.body()
        header = request.headers.get("x-videoai-envelope")
        if not header:
            raise HTTPException(status_code=401, detail="missing envelope")
        try:
            envelope = json.loads(header)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=401, detail="malformed envelope") from exc

        ok, reason = verify_envelope(signing_key, envelope, body_hash(raw), guard)
        if not ok:
            log.warning("rejected request: %s", reason)
            raise HTTPException(status_code=401, detail=reason)
        return json.loads(raw) if raw else {}

    @app.get("/health")
    async def health() -> HealthReport:
        # Unauthenticated on purpose: liveness has to work for the supervisor
        # and it discloses nothing an attacker on the private network gains from.
        return await adapter.health()

    @app.get("/capabilities")
    async def capabilities() -> Capabilities:
        return await adapter.capabilities()

    @app.post("/prepare")
    async def prepare(request: Request) -> dict[str, str]:
        await authorize(request)
        await adapter.prepare()
        return {"status": "ready"}

    @app.post("/load")
    async def load(request: Request) -> dict[str, str]:
        body = await authorize(request)
        await adapter.load(body["model_id"], body["model_version"], body.get("precision", "bf16"))
        return {"status": "loaded"}

    @app.post("/unload")
    async def unload(request: Request) -> dict[str, str]:
        body = await authorize(request)
        await adapter.unload(body.get("model_id"))
        return {"status": "unloaded"}

    @app.post("/estimate")
    async def estimate(request: Request) -> dict[str, Any]:
        body = await authorize(request)
        return (await adapter.estimate(GenerateRequest.model_validate(body))).model_dump()

    @app.post("/generate")
    async def generate(request: Request) -> GenerateResult:
        body = await authorize(request)
        payload = GenerateRequest.model_validate(body)

        if payload.job_id in completed:
            return completed[payload.job_id]
        if payload.job_id in in_flight:
            # A duplicate arriving mid-flight waits for the original rather
            # than starting a second run on the same GPU.
            return await in_flight[payload.job_id]

        task = asyncio.create_task(adapter.generate(payload))
        in_flight[payload.job_id] = task
        started = time.monotonic()
        try:
            result = await task
        except asyncio.CancelledError:
            raise HTTPException(status_code=409, detail="job cancelled") from None
        finally:
            in_flight.pop(payload.job_id, None)

        log.info("job %s finished in %.1fs", payload.job_id, time.monotonic() - started)
        completed[payload.job_id] = result
        return result

    @app.post("/cancel")
    async def cancel(request: Request) -> dict[str, bool]:
        body = await authorize(request)
        job_id = body["job_id"]
        task = in_flight.get(job_id)
        if task:
            task.cancel()
        return {"cancelled": await adapter.cancel(job_id) or task is not None}

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled worker error")
        # Detail stays generic; the full trace goes to the operator's logs.
        return JSONResponse(status_code=500, content={"detail": type(exc).__name__})

    return app
