"""Inference backends.

Two implementations behind one interface:

``CudaBackend`` runs the real model. ``StubBackend`` implements the same
contract without a GPU so the worker's protocol -- idempotency, cancellation,
validation, cache verification -- is testable in CI, which has no CUDA.

The stub is opt-in through WORKER_BACKEND and refuses to run when
WORKER_ALLOW_STUB is not set, so it cannot be reached accidentally in
production. There is no path here to an external provider: without local
compute the worker fails (spec section 78).
"""

from __future__ import annotations

import abc
import asyncio
import hashlib
import os
from dataclasses import dataclass, field

from videoai_worker import GenerateRequest


@dataclass
class DeviceInfo:
    detail: str
    cuda_version: str | None = None
    driver_version: str | None = None
    compute_capability: str | None = None
    gpu_count: int = 0
    vram_total_bytes: int = 0
    vram_free_bytes: int = 0
    temperature_c: float | None = None
    utilization_pct: float | None = None
    supported_precisions: list[str] = field(default_factory=list)


@dataclass
class BackendOutput:
    storage_key: str
    sha256: str
    peak_vram_bytes: int
    metadata: dict[str, object] = field(default_factory=dict)


class InferenceBackend(abc.ABC):
    @abc.abstractmethod
    def available(self) -> bool: ...

    @abc.abstractmethod
    def device_info(self) -> DeviceInfo: ...

    @abc.abstractmethod
    async def load(self, model_id: str, model_version: str, precision: str) -> object: ...

    @abc.abstractmethod
    async def unload(self, handle: object) -> None: ...

    @abc.abstractmethod
    async def generate(self, handle: object, request: GenerateRequest) -> BackendOutput: ...

    @abc.abstractmethod
    async def cancel(self, job_id: str) -> bool: ...

    def estimate_seconds(self, model_id: str, frames: int, pixels: int) -> float:
        # Rough shape until benchmarks replace it: cost is roughly linear in
        # frames and in pixels. Callers must treat this as an estimate.
        return frames * (pixels / (720 * 1280)) * 1.6

    def estimate_vram(self, model_id: str, precision: str) -> int:
        base = 80 if "a14b" in model_id else 60
        if precision == "fp8":
            base = int(base * 0.6)
        return base * 1024**3


class CudaBackend(InferenceBackend):
    """Real inference against locally held weights."""

    def __init__(self) -> None:
        self._running: dict[str, asyncio.Event] = {}

    def available(self) -> bool:
        try:
            import torch  # noqa: PLC0415

            return bool(torch.cuda.is_available())
        except ImportError:
            return False

    def device_info(self) -> DeviceInfo:
        try:
            import torch  # noqa: PLC0415
        except ImportError:
            return DeviceInfo(detail="torch is not installed in this runtime")

        if not torch.cuda.is_available():
            return DeviceInfo(detail="no CUDA device visible")

        free, total = torch.cuda.mem_get_info()
        major, minor = torch.cuda.get_device_capability(0)
        precisions = ["fp32", "fp16"]
        if torch.cuda.is_bf16_supported():
            precisions.append("bf16")
        # FP8 needs Hopper or newer; advertising it below that produces silent
        # quality loss rather than an error.
        if major >= 9:
            precisions.append("fp8")

        return DeviceInfo(
            detail=f"{torch.cuda.get_device_name(0)} ready",
            cuda_version=torch.version.cuda,
            compute_capability=f"{major}.{minor}",
            gpu_count=torch.cuda.device_count(),
            vram_total_bytes=total,
            vram_free_bytes=free,
            supported_precisions=precisions,
        )

    async def load(self, model_id: str, model_version: str, precision: str) -> object:
        if not self.available():
            raise RuntimeError(
                "No CUDA device is available. This worker runs models locally and "
                "has no remote fallback by design."
            )
        # Real weight loading is wired in once hardware exists; the pipeline
        # object is what generate() below receives as its handle.
        raise NotImplementedError(
            f"Weight loading for {model_id}@{model_version} at {precision} is not wired up yet. "
            "This path needs a GPU to implement and verify."
        )

    async def unload(self, handle: object) -> None:
        import gc  # noqa: PLC0415

        del handle
        gc.collect()
        try:
            import torch  # noqa: PLC0415

            torch.cuda.empty_cache()
        except ImportError:
            pass

    async def generate(self, handle: object, request: GenerateRequest) -> BackendOutput:
        raise NotImplementedError("Generation requires loaded weights on a CUDA device")

    async def cancel(self, job_id: str) -> bool:
        event = self._running.get(job_id)
        if event is None:
            return False
        event.set()
        return True


class StubBackend(InferenceBackend):
    """Contract-faithful backend with no model behind it.

    It honours timing, cancellation and determinism so the orchestration layer
    can be exercised end to end, and it produces a deterministic digest from
    the request rather than any media.
    """

    def __init__(self, frame_seconds: float = 0.001) -> None:
        self._frame_seconds = frame_seconds
        self._cancelled: set[str] = set()
        if os.environ.get("WORKER_ALLOW_STUB") != "1":
            raise RuntimeError(
                "The stub backend produces no media and must never serve real work. "
                "Set WORKER_ALLOW_STUB=1 to use it in tests."
            )

    def available(self) -> bool:
        return True

    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            detail="stub backend, no GPU",
            gpu_count=0,
            supported_precisions=["bf16", "fp16", "fp8", "fp32"],
        )

    async def load(self, model_id: str, model_version: str, precision: str) -> object:
        return {"model_id": model_id, "version": model_version, "precision": precision}

    async def unload(self, handle: object) -> None:
        return None

    async def generate(self, handle: object, request: GenerateRequest) -> BackendOutput:
        frames = request.duration_frames or 1
        # Sleep in slices so cancellation lands promptly rather than after the
        # whole nominal duration.
        for _ in range(frames):
            if request.job_id in self._cancelled:
                self._cancelled.discard(request.job_id)
                raise asyncio.CancelledError
            await asyncio.sleep(self._frame_seconds)

        # Same request in, same digest out, so idempotency is observable.
        seed_material = "|".join(
            [
                request.model_id,
                request.model_version,
                request.prompt,
                request.negative_prompt,
                str(request.seed),
                str(frames),
                f"{request.resolution.width}x{request.resolution.height}",
                *[r.sha256 for r in request.references],
            ]
        )
        digest = hashlib.sha256(seed_material.encode()).hexdigest()
        return BackendOutput(
            storage_key=f"stub/{request.organization_id}/{digest}.mp4",
            sha256=digest,
            peak_vram_bytes=0,
            metadata={"backend": "stub"},
        )

    async def cancel(self, job_id: str) -> bool:
        self._cancelled.add(job_id)
        return True


def resolve_backend() -> InferenceBackend:
    kind = os.environ.get("WORKER_BACKEND", "cuda").lower()
    if kind == "stub":
        return StubBackend()
    if kind == "cuda":
        return CudaBackend()
    raise ValueError(f"Unknown WORKER_BACKEND {kind!r}; expected 'cuda' or 'stub'")
