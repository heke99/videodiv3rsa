"""Wan2.2 runtime.

One container serves the whole Wan family -- T2V, I2V, S2V and Animate -- since
they share weights infrastructure and a Python environment. Which capability a
request uses is decided by the router, not here; this adapter's job is to load
the right weights, run the generation and report honestly about what happened.

The inference backend is pluggable so the contract, idempotency, cancellation
and cache verification can all be tested without a GPU. On a machine with no
CUDA the adapter refuses to load rather than silently producing something.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from videoai_worker import (
    ArtifactVerificationError,
    Capabilities,
    Capability,
    Estimate,
    GenerateRequest,
    GenerateResult,
    HealthReport,
    ModelAdapter,
    verify_artifacts,
)

from .backend import InferenceBackend, resolve_backend

RUNTIME = "runtime-wan"

# Capabilities this runtime serves. The registry is authoritative for what is
# routable; this is what the container can physically do.
WAN_CAPABILITIES: dict[str, Capability] = {
    "wan2.2-t2v-a14b": Capability(
        generation_kind="text_to_video",
        max_duration_frames=121,
        supported_precisions=["bf16", "fp8"],
    ),
    "wan2.2-i2v-a14b": Capability(
        generation_kind="image_to_video",
        max_duration_frames=121,
        supported_precisions=["bf16", "fp8"],
        accepts_reference_images=True,
    ),
    "wan2.2-s2v-14b": Capability(
        generation_kind="speech_to_video",
        max_duration_frames=121,
        supported_precisions=["bf16", "fp8"],
        accepts_reference_images=True,
        accepts_driving_audio=True,
    ),
    "wan2.2-animate-14b": Capability(
        generation_kind="character_animation",
        max_duration_frames=121,
        supported_precisions=["bf16", "fp8"],
        accepts_reference_images=True,
    ),
}


@dataclass
class LoadedModel:
    model_id: str
    model_version: str
    precision: str
    handle: object
    loaded_at: float = field(default_factory=time.monotonic)


class WanAdapter(ModelAdapter):
    runtime = RUNTIME

    def __init__(self, backend: InferenceBackend | None = None) -> None:
        self._backend = backend or resolve_backend()
        self._loaded: LoadedModel | None = None
        self._cancelled: set[str] = set()
        self._lock = asyncio.Lock()

    async def prepare(self) -> None:
        """Verify every Wan artifact this container is expected to serve."""
        artifacts = _declared_artifacts()
        if not artifacts:
            # Nothing declared means provisioning has not run. Serving anyway
            # would mean generating from whatever happens to be on disk.
            raise RuntimeError(
                "No model artifacts are declared for this runtime. "
                "Run provisioning before starting the worker."
            )
        checks = verify_artifacts(artifacts)
        if any(not c.verified for c in checks):
            raise ArtifactVerificationError(checks)

    async def health(self) -> HealthReport:
        info = self._backend.device_info()
        return HealthReport(
            healthy=self._backend.available(),
            detail=info.detail,
            loaded_models=[self._loaded.model_id] if self._loaded else [],
            vram_free_bytes=info.vram_free_bytes,
            temperature_c=info.temperature_c,
            utilization_pct=info.utilization_pct,
        )

    async def capabilities(self) -> Capabilities:
        info = self._backend.device_info()
        return Capabilities(
            runtime=RUNTIME,
            models=list(WAN_CAPABILITIES),
            capabilities=list(WAN_CAPABILITIES.values()),
            cuda_version=info.cuda_version,
            driver_version=info.driver_version,
            compute_capability=info.compute_capability,
            gpu_count=info.gpu_count,
            vram_total_bytes=info.vram_total_bytes,
            vram_free_bytes=info.vram_free_bytes,
            supported_precisions=info.supported_precisions,
        )

    async def estimate(self, request: GenerateRequest) -> Estimate:
        frames = request.duration_frames or 1
        pixels = request.resolution.width * request.resolution.height
        return Estimate(
            estimated_gpu_seconds=self._backend.estimate_seconds(request.model_id, frames, pixels),
            estimated_vram_bytes=self._backend.estimate_vram(request.model_id, request.precision),
        )

    async def load(self, model_id: str, model_version: str, precision: str) -> None:
        if model_id not in WAN_CAPABILITIES:
            raise ValueError(f"{model_id} is not served by {RUNTIME}")

        async with self._lock:
            current = self._loaded
            if (
                current
                and current.model_id == model_id
                and current.model_version == model_version
                and current.precision == precision
            ):
                return
            # One large model at a time: swapping without unloading first is how
            # a 96 GiB card runs out of memory mid batch.
            if current is not None:
                await self._backend.unload(current.handle)
                self._loaded = None
            handle = await self._backend.load(model_id, model_version, precision)
            self._loaded = LoadedModel(model_id, model_version, precision, handle)

    async def generate(self, request: GenerateRequest) -> GenerateResult:
        if request.model_id not in WAN_CAPABILITIES:
            raise ValueError(f"{request.model_id} is not served by {RUNTIME}")

        capability = WAN_CAPABILITIES[request.model_id]
        frames = request.duration_frames or 1
        if capability.max_duration_frames and frames > capability.max_duration_frames:
            raise ValueError(
                f"{request.model_id} produces at most {capability.max_duration_frames} frames, "
                f"asked for {frames}"
            )
        if capability.accepts_driving_audio and request.driving_audio is None:
            raise ValueError(
                f"{request.model_id} is speech driven and needs aligned dialogue audio"
            )

        await self.load(request.model_id, request.model_version, request.precision)
        assert self._loaded is not None

        started = time.monotonic()
        try:
            output = await self._backend.generate(self._loaded.handle, request)
        except asyncio.CancelledError:
            self._cancelled.discard(request.job_id)
            raise

        return GenerateResult(
            job_id=request.job_id,
            storage_key=output.storage_key,
            sha256=output.sha256,
            runtime_ms=int((time.monotonic() - started) * 1000),
            peak_vram_bytes=output.peak_vram_bytes,
            model_version=self._loaded.model_version,
            seed=request.seed,
            metadata={
                "frames": frames,
                "fps_num": request.fps_num,
                "fps_den": request.fps_den,
                "precision": request.precision,
                **output.metadata,
            },
        )

    async def cancel(self, job_id: str) -> bool:
        self._cancelled.add(job_id)
        return await self._backend.cancel(job_id)

    async def unload(self, model_id: str | None = None) -> None:
        async with self._lock:
            if self._loaded is None:
                return
            if model_id and self._loaded.model_id != model_id:
                return
            await self._backend.unload(self._loaded.handle)
            self._loaded = None


def _declared_artifacts() -> dict[str, str]:
    """Artifacts this container must have, injected by provisioning.

    Format is ``relative/path=sha256`` entries separated by commas, so the
    worker needs no database access to verify its own cache.
    """
    raw = os.environ.get("MODEL_ARTIFACTS", "").strip()
    if not raw:
        return {}
    artifacts: dict[str, str] = {}
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        relative, _, digest = entry.partition("=")
        if not digest:
            raise ValueError(f"Malformed MODEL_ARTIFACTS entry: {entry!r}")
        artifacts[str(Path(relative))] = digest
    return artifacts
