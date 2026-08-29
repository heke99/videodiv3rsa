"""Wan2.2 runtime.

One container serves the whole Wan family -- T2V, I2V, S2V and Animate -- since
they share a weights infrastructure and a Python environment. Which capability
a request uses is the router's decision, not this adapter's; here the job is to
load the right weights, run the generation, and report honestly about it.

Lifecycle bookkeeping lives in BaseRuntimeAdapter; what is here is what is
genuinely specific to Wan.
"""

from __future__ import annotations

from videoai_worker import (
    BaseRuntimeAdapter,
    Capability,
    GenerateRequest,
    InferenceBackend,
    resolve_backend,
)

RUNTIME = "runtime-wan"

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


class WanAdapter(BaseRuntimeAdapter):
    runtime = RUNTIME
    capabilities_by_model = WAN_CAPABILITIES

    def __init__(self, backend: InferenceBackend | None = None) -> None:
        super().__init__(backend or resolve_backend())

    def validate(self, request: GenerateRequest, capability: Capability) -> None:
        # Image-to-video and character animation are only meaningful with the
        # reference they are supposed to follow; without it the model quietly
        # behaves like plain text-to-video and identity drifts.
        if capability.accepts_reference_images and capability.generation_kind in {
            "image_to_video",
            "character_animation",
        }:
            if not request.references:
                raise ValueError(
                    f"{request.model_id} is reference driven and needs at least one reference image"
                )
