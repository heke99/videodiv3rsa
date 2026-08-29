"""Model cache verification (spec section 53).

The runtime never downloads. Provisioning places files under MODEL_ROOT and
records their hashes; the runtime's job is to refuse to start when what is on
disk is not what was approved.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path


def model_root() -> Path:
    root = os.environ.get("MODEL_ROOT")
    if not root:
        raise RuntimeError("MODEL_ROOT is required; the model cache location is configuration")
    return Path(root)


@dataclass(frozen=True)
class ArtifactCheck:
    file: str
    expected_sha256: str
    present: bool
    actual_sha256: str | None
    verified: bool


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def verify_artifacts(artifacts: dict[str, str], root: Path | None = None) -> list[ArtifactCheck]:
    """Check each ``relative path -> expected sha256`` pair against disk."""
    base = (root or model_root()).resolve()
    checks: list[ArtifactCheck] = []

    for relative, expected in artifacts.items():
        path = (base / relative).resolve()
        # A recorded path must stay inside the cache root.
        if path != base and base not in path.parents:
            checks.append(ArtifactCheck(relative, expected, False, None, False))
            continue
        if not path.is_file():
            checks.append(ArtifactCheck(relative, expected, False, None, False))
            continue
        actual = sha256_file(path)
        checks.append(ArtifactCheck(relative, expected, True, actual, actual == expected))

    return checks


class ArtifactVerificationError(RuntimeError):
    def __init__(self, checks: list[ArtifactCheck]) -> None:
        failures = [c for c in checks if not c.verified]
        lines = [
            f"  - {c.file}: {'missing' if not c.present else 'hash mismatch'}"
            for c in failures
        ]
        super().__init__(
            "Refusing to serve: model cache does not match the approved artifacts.\n"
            + "\n".join(lines)
        )
        self.checks = checks
