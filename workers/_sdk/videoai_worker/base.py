"""Shared runtime bookkeeping.

Loading, swapping and unloading a model, reporting health, and tracking
cancellation are identical for every model family. They live here so each
runtime contains only what is actually specific to its models, and so a fix to
the swap logic fixes it everywhere rather than in one of six copies.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from .contract import (
    Capabilities,
    Capability,
    Estimate,
    GenerateRequest,
    GenerateResult,
    HealthReport,
    ModelAdapter,
    Precision,
)
from .models import ArtifactVerificationError, verify_artifacts


@dataclass
class LoadedModel:
    model_id: str
    model_version: str
    precision: str
    handle: object
    loaded_at: float = field(default_factory=time.monotonic)


class BaseRuntimeAdapter(ModelAdapter):
    """Adapter with the common lifecycle handled.

    Subclasses declare which models they serve and implement the parts that
    differ: the backend, and any per-model validation.
    """

    runtime: str
    capabilities_by_model: dict[str, Capability]

    def __init__(self, backend) -> None:
        self._backend = backend
        self._loaded: LoadedModel | None = None
        self._lock = asyncio.Lock()

    # -- lifecycle -----------------------------------------------------------

    async def prepare(self) -> None:
        artifacts = declared_artifacts()
        if not artifacts:
            raise RuntimeError(
                "No model artifacts are declared for this runtime. "
                "Run provisioning before starting the worker."
            )
        checks = verify_artifacts(artifacts)
        if any(not c.verified for c in checks):
            raise ArtifactVerificationError(checks)

    async def load(self, model_id: str, model_version: str, precision: Precision) -> None:
        if model_id not in self.capabilities_by_model:
            raise ValueError(f"{model_id} is not served by {self.runtime}")

        async with self._lock:
            current = self._loaded
            if (
                current
                and current.model_id == model_id
                and current.model_version == model_version
                and current.precision == precision
            ):
                return
            # Unload before loading: swapping without freeing first is how a
            # large card runs out of memory in the middle of a batch.
            if current is not None:
                await self._backend.unload(current.handle)
                self._loaded = None
            handle = await self._backend.load(model_id, model_version, precision)
            self._loaded = LoadedModel(model_id, model_version, precision, handle)

    async def unload(self, model_id: str | None = None) -> None:
        async with self._lock:
            if self._loaded is None:
                return
            if model_id and self._loaded.model_id != model_id:
                return
            await self._backend.unload(self._loaded.handle)
            self._loaded = None

    async def cancel(self, job_id: str) -> bool:
        return await self._backend.cancel(job_id)

    # -- reporting -----------------------------------------------------------

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
            runtime=self.runtime,
            models=list(self.capabilities_by_model),
            capabilities=list(self.capabilities_by_model.values()),
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

    # -- generation ----------------------------------------------------------

    def validate(self, request: GenerateRequest, capability: Capability) -> None:
        """Per-model checks beyond the shared ones. Override where needed."""

    async def generate(self, request: GenerateRequest) -> GenerateResult:
        capability = self.capabilities_by_model.get(request.model_id)
        if capability is None:
            raise ValueError(f"{request.model_id} is not served by {self.runtime}")

        frames = request.duration_frames or 1
        if capability.max_duration_frames and frames > capability.max_duration_frames:
            raise ValueError(
                f"{request.model_id} produces at most {capability.max_duration_frames} frames, "
                f"asked for {frames}"
            )
        if capability.accepts_driving_audio and request.driving_audio is None:
            raise ValueError(f"{request.model_id} is audio driven and needs driving audio")
        self.validate(request, capability)

        await self.load(request.model_id, request.model_version, request.precision)
        assert self._loaded is not None

        started = time.monotonic()
        output = await self._backend.generate(self._loaded.handle, request)

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


def declared_artifacts() -> dict[str, str]:
    """Artifacts this container must have, injected by provisioning.

    ``relative/path=sha256`` entries separated by commas, so a worker can verify
    its own cache with no database access.
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
