"""MuseTalk runtime: lip sync repair.

This is a repair specialist, not a production path (spec section 8). The
primary route to talking video is Wan S2V, which generates motion from the
speech in the first place. MuseTalk exists for the case where a shot is good
except for the mouth, so the fix costs one pass instead of regenerating the
shot and losing everything else that was right about it.
"""

from __future__ import annotations

from videoai_worker import (
    BaseRuntimeAdapter,
    Capability,
    GenerateRequest,
    InferenceBackend,
    resolve_backend,
)

RUNTIME = "runtime-musetalk"

LIPSYNC_CAPABILITIES: dict[str, Capability] = {
    "musetalk": Capability(
        generation_kind="lipsync",
        max_duration_frames=600,
        supported_precisions=["fp16"],
        accepts_reference_images=True,
        accepts_driving_audio=True,
    ),
}

VRAM_GIB = {"musetalk": 10}


class MuseTalkAdapter(BaseRuntimeAdapter):
    runtime = RUNTIME
    capabilities_by_model = LIPSYNC_CAPABILITIES

    def __init__(self, backend: InferenceBackend | None = None) -> None:
        backend = backend or resolve_backend()
        backend.vram_gib = VRAM_GIB
        super().__init__(backend)

    def validate(self, request: GenerateRequest, capability: Capability) -> None:
        # The source video is what makes this a repair rather than a generation.
        if not any(r.role == "source_video" for r in request.references):
            raise ValueError(
                "Lip sync repair needs the shot it is repairing, as a source_video reference"
            )
        # Repairing against unaligned audio reintroduces the drift the repair
        # exists to remove.
        if not request.settings.get("alignment_id"):
            raise ValueError(
                "Lip sync repair needs the dialogue alignment so the mouth follows "
                "the audio that will actually ship"
            )


ADAPTER = MuseTalkAdapter
