"""Trade-tape loader tests (Volume Bars need a tape; Yahoo has no tick data)."""

from pathlib import Path

from fintech_volume_bars import construct_bars, load_trades

TAPE = Path(__file__).parent / "fixtures" / "trade_tape.csv"
CONFIG = {"targetVolume": 1000, "closePartial": True}


def test_load_trades_parses_tape():
    trades = load_trades(TAPE)
    assert len(trades) == 6
    assert trades[0]["tradeId"] == "W001"
    assert trades[0]["volume"] == 400.0 and isinstance(trades[0]["volume"], float)


def test_construct_bars_over_loaded_tape():
    bars = construct_bars(load_trades(TAPE), CONFIG)
    assert [b["volume"] for b in bars] == [1250.0, 1000.0, 250.0]
    assert bars[0]["dollarValue"] == 124850.0
