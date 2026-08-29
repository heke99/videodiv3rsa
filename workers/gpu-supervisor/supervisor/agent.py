"""Worker supervisor.

Runs beside the runtime containers on a GPU host and is the only thing on that
host that talks to our backend. It registers the worker, keeps its capabilities
and health current, and honours drain requests.

It reports; it does not decide. Scheduling lives in gpu-manager, so a host that
loses contact simply ages out of the fleet rather than continuing to accept work.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time

import httpx

from .scan import ScanResult, scan

log = logging.getLogger("videoai.supervisor")

HEARTBEAT_SECONDS = 30
# Runtimes the supervisor supervises, as image names it can probe for health.
DEFAULT_RUNTIME_PORT = 8080


class SupervisorConfig:
    def __init__(self, env: dict[str, str] | None = None) -> None:
        e = env or dict(os.environ)
        self.worker_id = _require(e, "WORKER_ID")
        self.control_plane = _require(e, "GPU_CONTROL_PLANE_URL").rstrip("/")
        self.worker_token = _require(e, "GPU_WORKER_TOKEN")
        self.endpoint = _require(e, "WORKER_ENDPOINT")
        self.provider = e.get("GPU_PROVIDER", "manual")
        self.runtimes = [r for r in e.get("WORKER_RUNTIMES", "").split(",") if r]


def _require(env: dict[str, str], key: str) -> str:
    value = env.get(key)
    if not value:
        raise RuntimeError(f"{key} is required by the GPU supervisor")
    return value


class Supervisor:
    def __init__(self, config: SupervisorConfig, client: httpx.AsyncClient | None = None) -> None:
        self.config = config
        self._client = client or httpx.AsyncClient(
            timeout=30.0,
            headers={"authorization": f"Bearer {config.worker_token}"},
        )
        self._draining = False

    async def register(self) -> ScanResult:
        result = scan()
        if not result.healthy:
            # Registering an unusable host would let the scheduler send it work.
            log.error("capability scan failed: %s", result.detail)
        await self._post(
            "/internal/workers/register",
            {
                "worker_id": self.config.worker_id,
                "provider": self.config.provider,
                "endpoint": self.config.endpoint,
                "profile": result.profile,
                "gpu_count": result.gpu_count,
                "vram_total_bytes": result.vram_total_bytes,
                "vram_free_bytes": result.vram_free_bytes,
                "cuda_version": result.cuda_version,
                "driver_version": result.driver_version,
                "compute_capability": result.compute_capability,
                "supported_precisions": result.supported_precisions,
                "runtimes": self.config.runtimes,
                "healthy": result.healthy,
                "detail": result.detail,
            },
        )
        return result

    async def heartbeat_once(self) -> bool:
        """Report current state. Returns whether the fleet wants us to drain."""
        result = scan()
        runtimes_ok = await self._probe_runtimes()

        response = await self._post(
            "/internal/workers/heartbeat",
            {
                "worker_id": self.config.worker_id,
                "healthy": result.healthy and runtimes_ok,
                "detail": result.detail,
                "vram_free_bytes": result.vram_free_bytes,
                "temperature_c": result.temperature_c,
                "utilization_pct": result.utilization_pct,
                "uptime_seconds": int(time.monotonic()),
            },
        )
        self._draining = bool(response.get("drain_requested", False))
        return self._draining

    async def run(self) -> None:
        await self.register()
        while True:
            try:
                if await self.heartbeat_once():
                    log.info("drain requested; stopping heartbeats once work completes")
                    return
            except httpx.HTTPError as exc:
                # A transient control-plane outage must not take the host down;
                # it simply ages out of scheduling until contact resumes.
                log.warning("heartbeat failed, will retry: %s", exc)
            await asyncio.sleep(HEARTBEAT_SECONDS)

    async def _probe_runtimes(self) -> bool:
        if not self.config.runtimes:
            return True
        for runtime in self.config.runtimes:
            try:
                response = await self._client.get(
                    f"http://{runtime}:{DEFAULT_RUNTIME_PORT}/health", timeout=5.0
                )
                if response.status_code != 200 or not response.json().get("healthy", False):
                    log.warning("runtime %s is unhealthy", runtime)
                    return False
            except httpx.HTTPError as exc:
                log.warning("runtime %s unreachable: %s", runtime, exc)
                return False
        return True

    async def _post(self, path: str, payload: dict) -> dict:
        response = await self._client.post(f"{self.config.control_plane}{path}", json=payload)
        response.raise_for_status()
        return response.json() if response.content else {}


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())
    asyncio.run(Supervisor(SupervisorConfig()).run())


if __name__ == "__main__":
    main()
