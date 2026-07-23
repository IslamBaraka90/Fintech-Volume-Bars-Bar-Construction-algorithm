"""Exactness and contract tests for Volume Bars.

The worked-example fixture ships its own ``expectedBars`` (covering overshoot,
exact equality, and a partial); both language suites assert them.
"""

import json
from pathlib import Path

import pytest

from fintech_volume_bars import VolumeBarsValidationError, construct_bars

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "worked_example.json").read_text())
CONFIG = FIXTURE["config"]
TRADES = FIXTURE["trades"]
EXPECTED = FIXTURE["expectedBars"]


def test_worked_example_matches_expected_bars():
    assert construct_bars(TRADES, CONFIG) == EXPECTED


def test_whole_trade_overshoot_and_exact_equality():
    bars = construct_bars(TRADES, CONFIG)
    # bar 0 overshoots (400+350+500 = 1250 >= 1000); bar 1 hits it exactly (600+400 = 1000).
    assert bars[0]["volume"] == 1250.0 and bars[0]["closeReason"] == "threshold"
    assert bars[1]["volume"] == 1000.0 and bars[1]["closeReason"] == "threshold"
    assert bars[2]["volume"] == 250.0 and bars[2]["closeReason"] == "stream_end"


def test_close_partial_false_drops_the_partial():
    bars = construct_bars(TRADES, {**CONFIG, "closePartial": False})
    assert [b["closeReason"] for b in bars] == ["threshold", "threshold"]


def test_single_large_trade_closes_immediately():
    # One trade whose volume already exceeds the target closes a one-tick bar.
    bars = construct_bars(TRADES[:1], {"targetVolume": 100})
    assert len(bars) == 1 and bars[0]["tickCount"] == 1 and bars[0]["closeReason"] == "threshold"


def test_empty_trades_returns_empty():
    assert construct_bars([], CONFIG) == []


def test_rejects_non_positive_target():
    with pytest.raises(VolumeBarsValidationError):
        construct_bars(TRADES, {"targetVolume": 0})


def test_rejects_unordered_trades():
    with pytest.raises(VolumeBarsValidationError):
        construct_bars(list(reversed(TRADES)), CONFIG)


def test_rejects_duplicate_trade_id():
    with pytest.raises(VolumeBarsValidationError):
        construct_bars([TRADES[0], {**TRADES[1], "tradeId": "W001"}], CONFIG)


def test_rejects_non_positive_volume():
    with pytest.raises(VolumeBarsValidationError):
        construct_bars([{**TRADES[0], "volume": 0}], CONFIG)


def test_rejects_mixed_symbol():
    with pytest.raises(VolumeBarsValidationError):
        construct_bars([TRADES[0], {**TRADES[1], "symbol": "OTHER"}], CONFIG)


def test_rejects_non_contiguous_session():
    a = {**TRADES[0], "session": "S1"}
    b = {**TRADES[1], "session": "S2"}
    c = {**TRADES[2], "session": "S1"}
    with pytest.raises(VolumeBarsValidationError):
        construct_bars([a, b, c], CONFIG)
