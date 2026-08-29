"""Entry point for the Wan runtime container."""

from __future__ import annotations

import logging
import os

import uvicorn
from videoai_worker import create_app

from wan_runtime.adapter import WanAdapter

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())

app = create_app(WanAdapter())

if __name__ == "__main__":
    uvicorn.run(
        app,
        # Binds inside the container's private network only; the worker is
        # never exposed to the internet (spec section 77).
        host=os.environ.get("WORKER_BIND", "0.0.0.0"),
        port=int(os.environ.get("WORKER_PORT", "8080")),
    )
