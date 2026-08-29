"""Per-runtime rules.

The shared contract is covered in test_worker_contract; what is asserted here
is what each media runtime refuses, because every one of these refusals stands
in for a specific way output goes quietly wrong: a keyframe with no source, a
character whose voice changes between shots, audio that fights the timeline, a
lip sync repair chasing the wrong audio.
"""

from __future__ import annotations

import pytest
from audio_runtime.adapter import MMAudioAdapter
from image_runtime.adapter import QwenImageAdapter
from lipsync_runtime.adapter import MuseTalkAdapter
from tts_runtime.adapter import QwenTTSAdapter
from videoai_worker import GenerateRequest, Resolution
from videoai_worker.backend import StubBackend
from vision_runtime.adapter import VisionAdapter


def make_request(model_id: str, **overrides) -> GenerateRequest:
    payload = {
        "job_id": "job-1",
        "project_id": "project-1",
        "organization_id": "org-1",
        "model_id": model_id,
        "model_version": "1.0.0",
        "seed": 7,
        "resolution": Resolution(width=1080, height=1920),
    }
    payload.update(overrides)
    return GenerateRequest(**payload)


def stub() -> StubBackend:
    return StubBackend(frame_seconds=0.0)


class TestImageRuntime:
    async def test_generates_a_keyframe(self):
        adapter = QwenImageAdapter(backend=stub())
        result = await adapter.generate(make_request("qwen-image-2", prompt="a product on marble"))
        assert result.sha256

    async def test_edit_mode_requires_a_source_image(self):
        adapter = QwenImageAdapter(backend=stub())
        with pytest.raises(ValueError, match="needs a source image"):
            await adapter.generate(make_request("qwen-image-2", settings={"mode": "edit"}))


class TestTtsRuntime:
    def voice(self, **overrides) -> dict:
        base = {"voice_id": "voice_001", "speaker_profile": "warm female", "language": "en"}
        base.update(overrides)
        return base

    async def test_speaks_with_a_resolved_voice_profile(self):
        adapter = QwenTTSAdapter(backend=stub())
        result = await adapter.generate(
            make_request("qwen3-tts", prompt="Hi, I have been using this for a month.",
                         settings={"voice": self.voice()})
        )
        assert result.sha256

    async def test_refuses_without_a_voice_profile(self):
        adapter = QwenTTSAdapter(backend=stub())
        with pytest.raises(ValueError, match="resolved voice profile"):
            await adapter.generate(make_request("qwen3-tts", prompt="Hello"))

    async def test_refuses_an_incomplete_voice_profile(self):
        adapter = QwenTTSAdapter(backend=stub())
        with pytest.raises(ValueError, match="missing language"):
            await adapter.generate(
                make_request("qwen3-tts", prompt="Hello",
                             settings={"voice": {"voice_id": "v", "speaker_profile": "p"}})
            )

    async def test_refuses_a_clone_without_a_rights_declaration(self):
        adapter = QwenTTSAdapter(backend=stub())
        with pytest.raises(ValueError, match="rights declaration"):
            await adapter.generate(
                make_request("qwen3-tts", prompt="Hello",
                             settings={"voice": self.voice(is_clone=True)})
            )

    async def test_refuses_empty_text(self):
        adapter = QwenTTSAdapter(backend=stub())
        with pytest.raises(ValueError, match="no text"):
            await adapter.generate(
                make_request("qwen3-tts", prompt="   ", settings={"voice": self.voice()})
            )


class TestAudioRuntime:
    def reference(self) -> list[dict]:
        return [{"role": "target_video", "storage_key": "k", "sha256": "a" * 64}]

    async def test_generates_against_a_target_video_and_duration(self):
        adapter = MMAudioAdapter(backend=stub())
        result = await adapter.generate(
            make_request("mmaudio", references=self.reference(),
                         settings={"target_duration_samples": 96_000})
        )
        assert result.sha256

    async def test_refuses_without_the_target_video(self):
        adapter = MMAudioAdapter(backend=stub())
        with pytest.raises(ValueError, match="needs the target video"):
            await adapter.generate(
                make_request("mmaudio", settings={"target_duration_samples": 96_000})
            )

    async def test_refuses_without_an_exact_target_duration(self):
        adapter = MMAudioAdapter(backend=stub())
        with pytest.raises(ValueError, match="target_duration_samples"):
            await adapter.generate(make_request("mmaudio", references=self.reference()))

    async def test_refuses_to_extend_the_canonical_timeline(self):
        adapter = MMAudioAdapter(backend=stub())
        with pytest.raises(ValueError, match="may not change the canonical timeline"):
            await adapter.generate(
                make_request("mmaudio", references=self.reference(),
                             settings={"target_duration_samples": 96_000, "extend_timeline": True})
            )


class TestLipsyncRuntime:
    def full_request(self, **overrides) -> GenerateRequest:
        payload = {
            "references": [{"role": "source_video", "storage_key": "k", "sha256": "b" * 64}],
            "driving_audio": {"role": "dialogue", "storage_key": "a", "sha256": "c" * 64},
            "settings": {"alignment_id": "align-1"},
        }
        payload.update(overrides)
        return make_request("musetalk", **payload)

    async def test_repairs_a_shot_against_aligned_dialogue(self):
        adapter = MuseTalkAdapter(backend=stub())
        assert (await adapter.generate(self.full_request())).sha256

    async def test_refuses_without_the_shot_it_is_repairing(self):
        adapter = MuseTalkAdapter(backend=stub())
        with pytest.raises(ValueError, match="source_video reference"):
            await adapter.generate(self.full_request(references=[]))

    async def test_refuses_without_the_dialogue_alignment(self):
        adapter = MuseTalkAdapter(backend=stub())
        with pytest.raises(ValueError, match="dialogue alignment"):
            await adapter.generate(self.full_request(settings={}))

    async def test_refuses_without_driving_audio(self):
        adapter = MuseTalkAdapter(backend=stub())
        with pytest.raises(ValueError, match="needs driving audio"):
            await adapter.generate(self.full_request(driving_audio=None))


class TestVisionRuntime:
    def aligned(self, **overrides) -> GenerateRequest:
        payload = {
            "prompt": "Hi, I have been using this for a month.",
            "driving_audio": {"role": "dialogue", "storage_key": "a", "sha256": "d" * 64},
            "settings": {"audio_sample_rate": 48_000},
        }
        payload.update(overrides)
        return make_request("whisperx", **payload)

    async def test_aligns_a_transcript_to_audio(self):
        adapter = VisionAdapter(backend=stub())
        assert (await adapter.generate(self.aligned())).sha256

    async def test_refuses_without_the_transcript(self):
        adapter = VisionAdapter(backend=stub())
        with pytest.raises(ValueError, match="needs the transcript"):
            await adapter.generate(self.aligned(prompt=""))

    async def test_refuses_without_a_sample_rate(self):
        adapter = VisionAdapter(backend=stub())
        with pytest.raises(ValueError, match="audio_sample_rate"):
            await adapter.generate(self.aligned(settings={}))
