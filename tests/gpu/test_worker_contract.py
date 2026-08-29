"""Worker contract tests.

These run without a GPU on purpose. What is under test is the protocol every
runtime shares -- validation, idempotency, cancellation, model swapping and
cache verification -- because those are the parts that break silently and the
parts that must behave identically across every model family.

Tests that need real weights live alongside these and are skipped without CUDA.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from pathlib import Path

import pytest

from videoai_worker import GenerateRequest, Resolution, verify_artifacts
from videoai_worker.models import ArtifactVerificationError
from wan_runtime.adapter import WanAdapter
from videoai_worker.backend import CudaBackend, StubBackend


def request(**overrides) -> GenerateRequest:
    payload = {
        "job_id": "job-1",
        "project_id": "project-1",
        "organization_id": "org-1",
        "model_id": "wan2.2-t2v-a14b",
        "model_version": "2.2.0",
        "prompt": "a woman walking through a market at golden hour",
        "seed": 42,
        "duration_frames": 8,
        "fps_num": 24,
        "fps_den": 1,
        "resolution": Resolution(width=720, height=1280),
    }
    payload.update(overrides)
    return GenerateRequest(**payload)


@pytest.fixture
def adapter() -> WanAdapter:
    return WanAdapter(backend=StubBackend(frame_seconds=0.001))


class TestValidation:
    async def test_rejects_a_model_this_runtime_does_not_serve(self, adapter):
        with pytest.raises(ValueError, match="not served by"):
            await adapter.generate(request(model_id="qwen-image-2"))

    async def test_rejects_a_shot_longer_than_the_model_produces(self, adapter):
        with pytest.raises(ValueError, match="at most 121 frames"):
            await adapter.generate(request(duration_frames=400))

    async def test_speech_driven_model_requires_driving_audio(self, adapter):
        with pytest.raises(ValueError, match="needs driving audio"):
            await adapter.generate(request(model_id="wan2.2-s2v-14b"))

    async def test_reference_driven_model_requires_a_reference(self, adapter):
        # Without its reference an I2V model quietly behaves like T2V and
        # identity drifts, which is worse than refusing.
        with pytest.raises(ValueError, match="needs at least one reference image"):
            await adapter.generate(request(model_id="wan2.2-i2v-a14b"))


class TestDeterminismAndIdempotency:
    async def test_identical_requests_produce_identical_output(self, adapter):
        first = await adapter.generate(request())
        second = await adapter.generate(request())
        assert first.sha256 == second.sha256

    async def test_a_different_seed_produces_different_output(self, adapter):
        first = await adapter.generate(request(seed=1))
        second = await adapter.generate(request(seed=2))
        assert first.sha256 != second.sha256

    async def test_reports_the_version_it_actually_loaded(self, adapter):
        result = await adapter.generate(request())
        assert result.model_version == "2.2.0"
        assert result.metadata["frames"] == 8


class TestModelLifecycle:
    async def test_loading_the_same_model_twice_is_a_no_op(self, adapter):
        await adapter.load("wan2.2-t2v-a14b", "2.2.0", "bf16")
        handle = adapter._loaded
        await adapter.load("wan2.2-t2v-a14b", "2.2.0", "bf16")
        assert adapter._loaded is handle

    async def test_switching_models_unloads_the_previous_one_first(self, adapter):
        unloaded: list[object] = []
        original = adapter._backend.unload

        async def track(handle):
            unloaded.append(handle)
            await original(handle)

        adapter._backend.unload = track  # type: ignore[method-assign]

        await adapter.load("wan2.2-t2v-a14b", "2.2.0", "bf16")
        first = adapter._loaded.handle
        await adapter.load("wan2.2-i2v-a14b", "2.2.0", "bf16")

        assert unloaded == [first]
        assert adapter._loaded.model_id == "wan2.2-i2v-a14b"

    async def test_health_reports_what_is_resident(self, adapter):
        assert (await adapter.health()).loaded_models == []
        await adapter.load("wan2.2-t2v-a14b", "2.2.0", "bf16")
        assert (await adapter.health()).loaded_models == ["wan2.2-t2v-a14b"]
        await adapter.unload()
        assert (await adapter.health()).loaded_models == []


class TestCancellation:
    async def test_a_cancelled_job_stops_rather_than_running_to_completion(self):
        adapter = WanAdapter(backend=StubBackend(frame_seconds=0.05))
        task = asyncio.create_task(adapter.generate(request(duration_frames=100)))
        await asyncio.sleep(0.05)

        assert await adapter.cancel("job-1") is True
        with pytest.raises(asyncio.CancelledError):
            await task


class TestModelCacheVerification:
    def test_a_matching_file_verifies(self, tmp_path: Path):
        target = tmp_path / "wan" / "weights.safetensors"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"weights")
        digest = hashlib.sha256(b"weights").hexdigest()

        checks = verify_artifacts({"wan/weights.safetensors": digest}, root=tmp_path)
        assert [c.verified for c in checks] == [True]

    def test_a_tampered_file_fails(self, tmp_path: Path):
        target = tmp_path / "weights.safetensors"
        target.write_bytes(b"tampered")
        digest = hashlib.sha256(b"original").hexdigest()

        checks = verify_artifacts({"weights.safetensors": digest}, root=tmp_path)
        assert [c.verified for c in checks] == [False]
        assert "hash mismatch" in str(ArtifactVerificationError(checks))

    def test_a_missing_file_fails(self, tmp_path: Path):
        checks = verify_artifacts({"absent.safetensors": "0" * 64}, root=tmp_path)
        assert [c.present for c in checks] == [False]

    def test_a_path_escaping_the_cache_root_is_refused(self, tmp_path: Path):
        outside = tmp_path.parent / "outside.safetensors"
        outside.write_bytes(b"x")
        checks = verify_artifacts({"../outside.safetensors": "0" * 64}, root=tmp_path)
        assert [c.verified for c in checks] == [False]

    async def test_prepare_refuses_when_provisioning_declared_nothing(self, adapter, monkeypatch):
        monkeypatch.delenv("MODEL_ARTIFACTS", raising=False)
        with pytest.raises(RuntimeError, match="Run provisioning"):
            await adapter.prepare()


class TestNoRemoteFallback:
    async def test_cuda_backend_fails_loudly_without_a_device(self):
        backend = CudaBackend()
        if backend.available():
            pytest.skip("this machine has CUDA; the no-device path is not reachable here")
        with pytest.raises(RuntimeError, match="no remote fallback"):
            await backend.load("wan2.2-t2v-a14b", "2.2.0", "bf16")

    def test_the_stub_refuses_to_run_unless_explicitly_allowed(self, monkeypatch):
        monkeypatch.delenv("WORKER_ALLOW_STUB", raising=False)
        with pytest.raises(RuntimeError, match="never serve real work"):
            StubBackend()
