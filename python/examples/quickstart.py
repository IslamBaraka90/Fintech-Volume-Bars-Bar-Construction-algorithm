"""Quickstart: build Volume Bars from a trade tape, batch and streaming.

Run:  python examples/quickstart.py
"""

from fintech_volume_bars import StreamingVolumeBarBuilder, construct_bars

config = {"targetVolume": 1000, "closePartial": True}
specs = [(100.0, 400), (101.0, 350), (99.0, 500), (99.5, 600), (100.5, 400), (101.0, 250)]
trades = [
    {"tradeId": f"W00{i+1}", "timestamp": f"2026-01-05T14:30:0{i}.000Z", "session": "2026-01-05",
     "symbol": "SYNTH", "price": p, "volume": v, "currency": "USD"}
    for i, (p, v) in enumerate(specs)
]

# 1) Batch: a bar closes once cumulative volume >= 1000 (the crossing trade stays whole).
for bar in construct_bars(trades, config):
    print(f"bar {bar['barIndex']}: C{bar['close']} vol={bar['volume']} ticks={bar['tickCount']} ({bar['closeReason']})")

# 2) Streaming: emit each bar the moment volume crosses the target.
print("--- streaming ---")
builder = StreamingVolumeBarBuilder(config)
for trade in trades:
    for bar in builder.push(trade):
        print(f"closed bar on {trade['tradeId']} at volume {bar['volume']} ({bar['closeReason']})")
for bar in builder.flush():
    print(f"flushed partial bar vol={bar['volume']} ({bar['closeReason']})")
