"""Qwen Image runtime.

Stills carry a disproportionate amount of the system's quality: a keyframe is
what makes identity and product fidelity hold through a video model, so this
runtime is on the critical path even though it produces no motion
(spec sections 5, 16).
"""

from __future__ import annotations

from videoai_worker import (
    BaseRuntimeAdapter,
    Capability,
    GenerateRequest,
    InferenceBackend,
    resolve_backend,
)

RUNTIME = "runtime-qwen-image"

IMAGE_CAPABILITIES: dict[str, Capability] = {
    "qwen-image-2": Capability(
        generation_kind="image",
        max_duration_frames=1,
        supported_precisions=["bf16", "fp16"],
        accepts_reference_images=True,
    ),
}

VRAM_GIB = {"qwen-image-2": 40}


class QwenImageAdapter(BaseRuntimeAdapter):
    runtime = RUNTIME
    capabilities_by_model = IMAGE_CAPABILITIES

    def __init__(self, backend: InferenceBackend | None = None) -> None:
        backend = backend or resolve_backend()
        backend.vram_gib = VRAM_GIB
        super().__init__(backend)

    def validate(self, request: GenerateRequest, capability: Capability) -> None:
        # An edit operates on something; without a source the request is a
        # plain generation wearing the wrong mode.
        if request.settings.get("mode") == "edit" and not request.references:
            raise ValueError("Image editing needs a source image reference")


ADAPTER = QwenImageAdapter
