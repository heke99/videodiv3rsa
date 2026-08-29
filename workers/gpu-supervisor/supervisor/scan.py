"""Capability detection.

The registry records what a worker can do, not what hardware it is. Everything
here is expressed as a capability -- VRAM, precisions, CUDA level -- so
scheduling never has to know a product name and moving to different hardware
changes no code (spec sections 2, 5, 51).
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, field

# VRAM thresholds, in GiB, that define each profile.
PROFILE_THRESHOLDS: list[tuple[int, str]] = [
    (96, "GPU_PROFILE_ULTRA"),
    (80, "GPU_PROFILE_HIGH"),
    (48, "GPU_PROFILE_STANDARD"),
    (24, "GPU_PROFILE_ECONOMY"),
]


@dataclass
class ScanResult:
    healthy: bool
    detail: str
    profile: str | None = None
    gpu_count: int = 0
    vram_total_bytes: int = 0
    vram_free_bytes: int = 0
    cuda_version: str | None = None
    driver_version: str | None = None
    compute_capability: str | None = None
    supported_precisions: list[str] = field(default_factory=list)
    temperature_c: float | None = None
    utilization_pct: float | None = None


def classify_profile(vram_total_bytes: int) -> str | None:
    """Largest profile the card can actually serve.

    Rounding down is deliberate: advertising a profile the hardware cannot hold
    means jobs are scheduled and then fail out of memory, which is worse than
    never scheduling them.
    """
    gib = vram_total_bytes / 1024**3
    for threshold, profile in PROFILE_THRESHOLDS:
        # A little slack for the few GiB a card reserves for itself.
        if gib >= threshold * 0.95:
            return profile
    return None


def scan(timeout_seconds: float = 15.0) -> ScanResult:
    if shutil.which("nvidia-smi") is None:
        return ScanResult(healthy=False, detail="nvidia-smi not found; this host has no NVIDIA GPU")

    query = "memory.total,memory.free,driver_version,compute_cap,temperature.gpu,utilization.gpu"
    try:
        output = subprocess.run(
            ["nvidia-smi", f"--query-gpu={query}", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=True,
        ).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        return ScanResult(healthy=False, detail=f"nvidia-smi failed: {exc}")

    rows = [line.split(",") for line in output.strip().splitlines() if line.strip()]
    if not rows:
        return ScanResult(healthy=False, detail="nvidia-smi reported no devices")

    total = sum(int(float(r[0])) for r in rows) * 1024**2
    free = sum(int(float(r[1])) for r in rows) * 1024**2
    driver = rows[0][2].strip()
    compute = rows[0][3].strip()

    precisions = ["fp32", "fp16"]
    try:
        major = int(compute.split(".")[0])
    except ValueError:
        major = 0
    if major >= 8:
        precisions.append("bf16")
    # FP8 tensor cores arrive with Hopper; claiming it earlier silently degrades
    # quality instead of failing.
    if major >= 9:
        precisions.append("fp8")

    profile = classify_profile(total)
    return ScanResult(
        healthy=profile is not None,
        detail=(
            f"{len(rows)} GPU(s), {total / 1024**3:.0f} GiB total"
            if profile
            else f"{total / 1024**3:.0f} GiB is below the smallest supported profile"
        ),
        profile=profile,
        gpu_count=len(rows),
        vram_total_bytes=total,
        vram_free_bytes=free,
        driver_version=driver,
        compute_capability=compute,
        cuda_version=_cuda_version(timeout_seconds),
        supported_precisions=precisions,
        temperature_c=float(rows[0][4]) if rows[0][4].strip() not in {"", "[N/A]"} else None,
        utilization_pct=float(rows[0][5]) if rows[0][5].strip() not in {"", "[N/A]"} else None,
    )


def _cuda_version(timeout_seconds: float) -> str | None:
    if shutil.which("nvcc") is None:
        return None
    try:
        out = subprocess.run(
            ["nvcc", "--version"], capture_output=True, text=True, timeout=timeout_seconds, check=True
        ).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    for token in out.split():
        if token.startswith("V") and token[1:2].isdigit():
            return token[1:]
    return None
