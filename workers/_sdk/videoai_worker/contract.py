"""Model adapter contract (spec section 55).

Every runtime -- Wan, Qwen Image, Qwen TTS, MMAudio, MuseTalk, WhisperX --
implements this same surface, so the orchestrator drives them all through one
code path and a new model is a new container rather than a new integration.
"""

from __future__ import annotations

import abc
from typing import Any, Literal

from pydantic import BaseModel, Field

Precision = Literal["fp32", "bf16", "fp16", "fp8"]


class Resolution(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ReferenceInput(BaseModel):
    role: str
    storage_key: str
    sha256: str
    strength: float = Field(default=1.0, ge=0.0, le=1.0)


class GenerateRequest(BaseModel):
    """Mirrors @videoai/contracts GenerateRequest.

    ``job_id`` doubles as the idempotency key: a retried activity carrying the
    same id must return the first result rather than generate a second time.
    """

    job_id: str
    project_id: str
    organization_id: str
    shot_id: str | None = None
    attempt: int = 1
    model_id: str
    model_version: str
    precision: Precision = "bf16"
    prompt: str = ""
    negative_prompt: str = ""
    references: list[ReferenceInput] = Field(default_factory=list)
    driving_audio: ReferenceInput | None = None
    seed: int = 0
    # Timing is integer and rational, matching the project timebase exactly.
    duration_frames: int | None = None
    fps_num: int | None = None
    fps_den: int | None = None
    resolution: Resolution
    settings: dict[str, Any] = Field(default_factory=dict)


class GenerateResult(BaseModel):
    job_id: str
    storage_key: str
    sha256: str
    runtime_ms: int
    peak_vram_bytes: int
    model_version: str
    seed: int
    metadata: dict[str, Any] = Field(default_factory=dict)


class Capability(BaseModel):
    generation_kind: str
    max_duration_frames: int = 0
    supported_precisions: list[Precision] = Field(default_factory=lambda: ["bf16"])
    accepts_reference_images: bool = False
    accepts_driving_audio: bool = False
    produces_audio: bool = False


class Capabilities(BaseModel):
    runtime: str
    models: list[str]
    capabilities: list[Capability]
    cuda_version: str | None = None
    driver_version: str | None = None
    compute_capability: str | None = None
    gpu_count: int = 0
    vram_total_bytes: int = 0
    vram_free_bytes: int = 0
    supported_precisions: list[Precision] = Field(default_factory=list)


class HealthReport(BaseModel):
    healthy: bool
    detail: str = ""
    loaded_models: list[str] = Field(default_factory=list)
    vram_free_bytes: int = 0
    temperature_c: float | None = None
    utilization_pct: float | None = None


class Estimate(BaseModel):
    """An estimate, and labelled as one (spec section 110)."""

    estimated_gpu_seconds: float
    estimated_vram_bytes: int
    is_estimate: Literal[True] = True


class ModelAdapter(abc.ABC):
    """What a runtime must implement.

    ``load`` and ``unload`` are separate from ``generate`` on purpose: the
    scheduler batches work by model so a large model is loaded once and used
    for everything that needs it, rather than paged in per request.
    """

    runtime: str

    @abc.abstractmethod
    async def prepare(self) -> None:
        """Verify model files against their recorded hashes.

        Must never download. Missing or mismatched weights are a provisioning
        failure, not something to fix at runtime (spec section 53).
        """

    @abc.abstractmethod
    async def health(self) -> HealthReport: ...

    @abc.abstractmethod
    async def capabilities(self) -> Capabilities: ...

    @abc.abstractmethod
    async def estimate(self, request: GenerateRequest) -> Estimate: ...

    @abc.abstractmethod
    async def load(self, model_id: str, model_version: str, precision: Precision) -> None: ...

    @abc.abstractmethod
    async def generate(self, request: GenerateRequest) -> GenerateResult: ...

    @abc.abstractmethod
    async def cancel(self, job_id: str) -> bool:
        """Stop a running job. Returns whether anything was actually cancelled."""

    @abc.abstractmethod
    async def unload(self, model_id: str | None = None) -> None: ...
