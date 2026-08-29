"""Capability classification.

Profile selection decides what work a host is offered, so the boundaries and
the refusal case are worth asserting directly.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "workers" / "gpu-supervisor"))

from supervisor.scan import classify_profile

GIB = 1024**3


class TestProfileClassification:
    def test_a_96_gib_card_is_ultra(self):
        assert classify_profile(96 * GIB) == "GPU_PROFILE_ULTRA"

    def test_an_80_gib_card_is_high(self):
        assert classify_profile(80 * GIB) == "GPU_PROFILE_HIGH"

    def test_a_48_gib_card_is_standard(self):
        assert classify_profile(48 * GIB) == "GPU_PROFILE_STANDARD"

    def test_a_24_gib_card_is_economy(self):
        assert classify_profile(24 * GIB) == "GPU_PROFILE_ECONOMY"

    def test_reserved_vram_does_not_demote_a_card(self):
        # Cards report slightly under their nominal size once firmware takes
        # its share; 95 GiB is still an ULTRA host.
        assert classify_profile(95 * GIB) == "GPU_PROFILE_ULTRA"

    def test_a_card_below_the_smallest_profile_is_refused(self):
        assert classify_profile(16 * GIB) is None

    def test_a_card_rounds_down_rather_than_up(self):
        # 70 GiB cannot hold an 80 GiB model, so it must not advertise HIGH.
        assert classify_profile(70 * GIB) == "GPU_PROFILE_STANDARD"
