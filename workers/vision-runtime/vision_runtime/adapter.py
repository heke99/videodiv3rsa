"""Vision and alignment runtime.

Two jobs that share a container because both are analysis rather than
generation, and both are small enough to sit beside each other:

WhisperX produces the word and phoneme timings that captions and lip sync are
built from. The QC vision model backs the judge ensemble.

Neither writes media, and neither is ever the sole arbiter of quality: judges
combine this with tracking, motion and technical metrics (spec section 32).
"""

from __future__ import annotations

from videoai_worker import (
    BaseRuntimeAdapter,
    Capability,
    GenerateRequest,
    InferenceBackend,
    resolve_backend,
)

RUNTIME = "runtime-qc"

VISION_CAPABILITIES: dict[str, Capability] = {
    "whisperx": Capability(
        generation_kind="alignment",
        supported_precisions=["fp16"],
        accepts_driving_audio=True,
    ),
}

VRAM_GIB = {"whisperx": 8}


class VisionAdapter(BaseRuntimeAdapter):
    runtime = RUNTIME
    capabilities_by_model = VISION_CAPABILITIES

    def __init__(self, backend: InferenceBackend | None = None) -> None:
        backend = backend or resolve_backend()
        backend.vram_gib = VRAM_GIB
        super().__init__(backend)

    def validate(self, request: GenerateRequest, capability: Capability) -> None:
        if capability.generation_kind == "alignment":
            if not request.prompt.strip():
                raise ValueError(
                    "Forced alignment needs the transcript the audio was generated from"
                )
            # Alignment output is in samples against a known rate; without the
            # rate the timings cannot be placed on the timeline.
            rate = request.settings.get("audio_sample_rate")
            if not isinstance(rate, int) or rate <= 0:
                raise ValueError("Alignment needs audio_sample_rate to return sample-accurate timings")


ADAPTER = VisionAdapter
