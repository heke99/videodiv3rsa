import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "workers" / "_sdk"))
for _runtime in ("wan", "image", "tts", "audio", "lipsync", "vision"):
    sys.path.insert(0, str(ROOT / "workers" / f"{_runtime}-runtime"))

# These tests exercise the worker contract, not the models, so the stub backend
# is both allowed and required here.
os.environ.setdefault("WORKER_ALLOW_STUB", "1")
os.environ.setdefault("WORKER_BACKEND", "stub")
os.environ.setdefault("GPU_GATEWAY_SIGNING_KEY", "test-signing-key-that-is-long-enough-000000")
