"""Qwen3-TTS runtime.

Voice is a persistent project identity, not a per-request style
(spec section 6). Every request carries the voice profile that identity
resolves to, and the same profile with the same text must produce the same
audio, otherwise a character's voice drifts between shots.
"""

from __future__ import annotations

from videoai_worker import (
    BaseRuntimeAdapter,
    Capability,
    GenerateRequest,
    InferenceBackend,
    resolve_backend,
)

RUNTIME = "runtime-qwen-tts"

TTS_CAPABILITIES: dict[str, Capability] = {
    "qwen3-tts": Capability(
        generation_kind="text_to_speech",
        supported_precisions=["bf16", "fp16"],
        produces_audio=True,
    ),
}

VRAM_GIB = {"qwen3-tts": 12}

REQUIRED_VOICE_FIELDS = ("voice_id", "speaker_profile", "language")


class QwenTTSAdapter(BaseRuntimeAdapter):
    runtime = RUNTIME
    capabilities_by_model = TTS_CAPABILITIES

    def __init__(self, backend: InferenceBackend | None = None) -> None:
        backend = backend or resolve_backend()
        backend.vram_gib = VRAM_GIB
        super().__init__(backend)

    def validate(self, request: GenerateRequest, capability: Capability) -> None:
        if not request.prompt.strip():
            raise ValueError("Nothing to speak: the request carries no text")

        voice = request.settings.get("voice")
        if not isinstance(voice, dict):
            raise ValueError(
                "Speech generation needs a resolved voice profile so the same "
                "character sounds the same in every shot"
            )
        missing = [f for f in REQUIRED_VOICE_FIELDS if not voice.get(f)]
        if missing:
            raise ValueError(f"Voice profile is missing {', '.join(missing)}")

        # A cloned voice cannot be used without a recorded rights declaration
        # (spec section 75). The runtime enforces it too, so a bug upstream
        # cannot turn into an unauthorised clone.
        if voice.get("is_clone") and not voice.get("rights_declaration_id"):
            raise ValueError(
                "Voice cloning requires a recorded rights declaration for the reference audio"
            )


ADAPTER = QwenTTSAdapter
