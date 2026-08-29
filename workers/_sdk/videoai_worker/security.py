"""Envelope verification, mirroring services/gpu-manager/src/gateway.ts.

A worker is not on the public network, but it still refuses anything it cannot
prove came from our backend: defence in depth, so a mistake in the network
policy is not immediately a way to run jobs on our GPUs.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from collections import OrderedDict


class ReplayGuard:
    """Bounded nonce cache.

    Only nonces from envelopes that have not yet expired matter, so the cache is
    capped and evicts oldest-first. An unbounded set here would be a slow memory
    leak on a long-lived worker.
    """

    def __init__(self, max_entries: int = 8192) -> None:
        self._seen: OrderedDict[str, float] = OrderedDict()
        self._max = max_entries

    def seen(self, nonce: str) -> bool:
        self._evict()
        return nonce in self._seen

    def remember(self, nonce: str, expires_at: float) -> None:
        self._seen[nonce] = expires_at
        self._seen.move_to_end(nonce)
        while len(self._seen) > self._max:
            self._seen.popitem(last=False)

    def _evict(self) -> None:
        now = time.time()
        expired = [n for n, exp in self._seen.items() if exp <= now]
        for nonce in expired:
            self._seen.pop(nonce, None)


def body_hash(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def verify_envelope(
    key: str,
    envelope: dict[str, object],
    payload_hash: str,
    guard: ReplayGuard,
    now: float | None = None,
) -> tuple[bool, str]:
    now = time.time() if now is None else now
    try:
        job_id = str(envelope["job_id"])
        nonce = str(envelope["nonce"])
        issued_at = int(envelope["issued_at"])  # type: ignore[arg-type]
        expires_at = int(envelope["expires_at"])  # type: ignore[arg-type]
        signature = str(envelope["signature"])
    except (KeyError, TypeError, ValueError):
        return False, "malformed envelope"

    if expires_at <= now:
        return False, "envelope expired"
    if issued_at > now + 60:
        return False, "issued in the future"
    if guard.seen(nonce):
        return False, "nonce already used"

    payload = "\n".join([job_id, nonce, str(issued_at), str(expires_at), payload_hash])
    expected = hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return False, "signature mismatch"

    guard.remember(nonce, expires_at)
    return True, "ok"
