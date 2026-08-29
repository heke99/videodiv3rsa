"""MMAudio runtime: sound derived from picture.

Footsteps, doors, wind, traffic, impacts, room ambience -- generated against a
finished video so they land on the action rather than near it.

MMAudio is given a target video, a target duration and audio cues, and it may
not change the canonical timeline (spec section 7). That rule is enforced here:
a request that tries to redefine timing is rejected rather than quietly
producing audio the mixer then has to fight.
"""

from __future__ import annotations

from videoai_worker import (
    BaseRuntimeAdapter,
    Capability,
    GenerateRequest,
    InferenceBackend,
    resolve_backend,
)

RUNTIME = "runtime-mmaudio"

AUDIO_CAPABILITIES: dict[str, Capability] = {
    "mmaudio": Capability(
        generation_kind="video_to_audio",
        supported_precisions=["fp16"],
        accepts_driving_audio=False,
        produces_audio=True,
    ),
}

VRAM_GIB = {"mmaudio": 12}


class MMAudioAdapter(BaseRuntimeAdapter):
    runtime = RUNTIME
    capabilities_by_model = AUDIO_CAPABILITIES

    def __init__(self, backend: InferenceBackend | None = None) -> None:
        backend = backend or resolve_backend()
        backend.vram_gib = VRAM_GIB
        super().__init__(backend)

    def validate(self, request: GenerateRequest, capability: Capability) -> None:
        if not request.references:
            raise ValueError("Video-to-audio needs the target video as a reference")

        # Duration is dictated by the timeline, in samples, and arrives with the
        # request. The model fills that window; it does not choose it.
        target = request.settings.get("target_duration_samples")
        if not isinstance(target, int) or target <= 0:
            raise ValueError(
                "target_duration_samples is required so generated audio matches the "
                "timeline exactly rather than approximately"
            )
        if request.settings.get("extend_timeline"):
            raise ValueError(
                "This model may not change the canonical timeline; "
                "adjust the timeline first and regenerate"
            )


ADAPTER = MMAudioAdapter
