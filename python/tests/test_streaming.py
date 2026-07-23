"""StreamingVolumeBarBuilder must produce byte-identical bars to the batch kernel."""

import json
from pathlib import Path

import pytest

from fintech_volume_bars import StreamingVolumeBarBuilder, VolumeBarsValidationError, construct_bars

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "worked_example.json").read_text())
CONFIG = FIXTURE["config"]
TRADES = FIXTURE["trades"]


def _stream(trades, config):
    builder = StreamingVolumeBarBuilder(config)
    emitted = builder.push_many(trades)
    emitted.extend(builder.flush())
    return emitted


def test_streaming_matches_batch():
    assert _stream(TRADES, CONFIG) == construct_bars(TRADES, CONFIG)


def test_streaming_matches_batch_close_partial_false():
    config = {**CONFIG, "closePartial": False}
    assert _stream(TRADES, config) == construct_bars(TRADES, config)


def test_push_emits_when_volume_crosses_target():
    builder = StreamingVolumeBarBuilder(CONFIG)  # target 1000
    assert builder.push(TRADES[0]) == []          # 400
    assert builder.push(TRADES[1]) == []          # 750
    closed = builder.push(TRADES[2])              # 1250 -> crosses
    assert len(closed) == 1 and closed[0]["volume"] == 1250.0


def test_flush_closes_final_partial():
    builder = StreamingVolumeBarBuilder(CONFIG)
    builder.push_many(TRADES)
    final = builder.flush()
    assert len(final) == 1 and final[0]["closeReason"] == "stream_end"


def test_cannot_push_after_flush():
    builder = StreamingVolumeBarBuilder(CONFIG)
    builder.push_many(TRADES)
    builder.flush()
    with pytest.raises(VolumeBarsValidationError):
        builder.push(TRADES[0])


def test_streaming_validates_incrementally():
    builder = StreamingVolumeBarBuilder(CONFIG)
    builder.push(TRADES[0])
    with pytest.raises(VolumeBarsValidationError):
        builder.push({**TRADES[1], "tradeId": "W001"})
