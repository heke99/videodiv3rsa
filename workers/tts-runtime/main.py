"""Entry point for the tts-runtime container."""

from __future__ import annotations

import logging
import os

import uvicorn
from tts_runtime.adapter import ADAPTER
from videoai_worker import create_app

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())

app = create_app(ADAPTER())

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("WORKER_BIND", "0.0.0.0"),
        port=int(os.environ.get("WORKER_PORT", "8080")),
    )
