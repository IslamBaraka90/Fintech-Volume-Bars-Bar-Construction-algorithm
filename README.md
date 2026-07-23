# Fintech Volume Bars — Bar Construction Algorithm

> A canonical, well-specified, **cross-language (Python + TypeScript)** reference
> implementation of **Volume Bars** — aggregating a trade tape into bars that each
> accumulate at least `targetVolume` traded units (an *activity clock*) — with a
> **streaming (incremental) builder** and strict, auditable validation.

<p>
  <img alt="Python" src="https://img.shields.io/badge/python-3.10%2B-blue">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.7%2B-3178c6">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Tests" src="https://img.shields.io/badge/tests-19%20py%20%2F%2018%20ts-brightgreen">
</p>

**📖 Full article (canonical):** **[Volume Bars — The Fintech Builder](https://thefintechbuilder.com/market-data-engineering/bar-construction/volume-bars/)**

This repository is the runnable, production-oriented companion to that article.
The article teaches the concept; this repo is the code you install and build on.

🧭 **Browse all algorithms:** [Awesome FinTech Algorithms](https://github.com/IslamBaraka90/Fintech-Algorithms-Awesome) — the full index of the library.
🗂️ **This algorithm's domain:** [Market Data Engineering](https://thefintechbuilder.com/domains/market-data-engineering/) › **Bar Construction**
↔️ **Sibling bar types:** [Time Bars](https://github.com/IslamBaraka90/Fintech-Time-Bars-Bar-Construction-algorithm) (clock) · [Tick Bars](https://github.com/IslamBaraka90/Fintech-Tick-Bars-Bar-Construction-algorithm) (trade count).

| | |
|---|---|
| **Catalog topic** | `D01-F01-A03` |
| **Domain** | D01 — Market Data Engineering |
| **Family** | D01-F01 — Bar Construction |
| **Difficulty** | 2 / 5 |
| **Languages** | Python, TypeScript |

---

## Table of contents

- [What are Volume Bars?](#what-are-volume-bars)
- [Whole-trade vs split conventions](#whole-trade-vs-split-conventions)
- [Why this implementation](#why-this-implementation)
- [Install](#install)
- [Quickstart](#quickstart)
- [Streaming (live tapes)](#streaming-live-tapes)
- [Loading a trade tape](#loading-a-trade-tape)
- [Bar & config shapes](#bar--config-shapes)
- [Worked example (exact)](#worked-example-exact)
- [API reference](#api-reference)
- [Edge cases & limitations](#edge-cases--limitations)
- [Testing](#testing)
- [Related algorithms](#related-algorithms)
- [License](#license)

---

## What are Volume Bars?

A **volume bar** closes once the trades inside it have accumulated at least
`targetVolume` units — sampling the market by *how much traded* rather than by
clock time or trade count.

```
V_j = sum of trade volumes in bar B_j
close B_j at the first trade for which V_j >= targetVolume
```

Volume bars are a staple of quant research (López de Prado, *Advances in
Financial Machine Learning*): they synchronize the information content of bars,
producing returns closer to i.i.d. and heavier sampling exactly when the market
is busy.

## Whole-trade vs split conventions

When a trade pushes the running total *past* the target, two conventions exist:

- **Whole-trade (this package):** the crossing trade stays entirely in the
  closing bar, which therefore **overshoots** the target. Overshoot is not split
  and not carried numerically to the next bar.
- **Split:** the crossing trade is divided so each bar holds exactly
  `targetVolume`. This distorts per-trade attribution (a trade id lands in two
  bars) and is *not* used here.

The whole-trade rule keeps every trade atomic and every `tradeId` in exactly one
bar — the auditable choice.

## Why this implementation

- **Whole-trade `>=` threshold** — bars overshoot rather than split; the crossing
  trade stays intact.
- **Session-aware** — a session change closes the open bar; each session must
  occupy one contiguous input block.
- **A streaming builder** (`StreamingVolumeBarBuilder`) that emits a bar the
  instant volume crosses the target — byte-identical to the batch kernel,
  validated incrementally.
- **Strict validation** through one `VolumeBarsValidationError` (chronology,
  unique ids, one symbol/currency, positive price/volume).
- **Cross-language parity** — the worked-example tape yields the same three bars.

## Install

**Python**

```bash
pip install fintech-volume-bars
```

**TypeScript / JavaScript (Node ≥ 20)**

```bash
npm install fintech-volume-bars
```

## Quickstart

**Python**

```python
from fintech_volume_bars import construct_bars

bars = construct_bars(trades, {"targetVolume": 10_000})
```

**TypeScript**

```ts
import { constructBars } from "fintech-volume-bars";

const bars = constructBars(trades, { targetVolume: 10_000 });
```

## Streaming (live tapes)

`StreamingVolumeBarBuilder` emits a bar the moment cumulative volume crosses the
target. `push` returns the bars closed by that trade (usually 0 or 1); `flush`
closes the final partial bar.

```python
from fintech_volume_bars import StreamingVolumeBarBuilder

builder = StreamingVolumeBarBuilder({"targetVolume": 10_000})
for trade in tape:                    # your live source
    for bar in builder.push(trade):
        publish(bar)
for bar in builder.flush():
    publish(bar)
```

```ts
const builder = new StreamingVolumeBarBuilder({ targetVolume: 10_000 });
for (const trade of tape) for (const bar of builder.push(trade)) publish(bar);
for (const bar of builder.flush()) publish(bar);
```

## Loading a trade tape

Volume bars are built from **individual trades**, and Yahoo Finance does **not**
expose tick data (it serves pre-aggregated bars only). So the real-data path is
a trade tape:

```python
from fintech_volume_bars import construct_bars, load_trades

trades = load_trades("tape.csv")   # tradeId,timestamp,session,symbol,price,volume,currency
bars = construct_bars(trades, {"targetVolume": 10_000})
```

> **Data note:** the committed fixtures are synthetic and exist only to exercise
> the load → construct path. They are not real market observations.

## Bar & config shapes

**Config:** `targetVolume` (finite positive) · `closePartial` (default `true`).

**Bar** (per emitted bar): `barIndex, session, startTime, endTime, lastTradeTime,
open, high, low, close, volume, dollarValue, tickCount, firstTradeId,
lastTradeId, closeReason` (`"threshold" | "session_end" | "stream_end"`).

## Worked example (exact)

`targetVolume = 1000` over six trades W001…W006:

| bar | trades | volumes | bar volume | O/H/L/C | closeReason |
|---|---|---|--:|---|---|
| 0 | W001–W003 | 400+350+500 | **1250** (overshoot) | 100/101/99/99 | threshold |
| 1 | W004–W005 | 600+400 | **1000** (exact) | 99.5/100.5/99.5/100.5 | threshold |
| 2 | W006 | 250 | **250** (partial) | 101/101/101/101 | stream_end |

Bar 0 overshoots the target because the crossing trade (W003) stays whole; bar 1
hits it exactly; W006 is emitted only under `closePartial = true`. These exact
bars are the shared acceptance values asserted by **both** language test suites.

## API reference

| Purpose | Python | TypeScript |
|---|---|---|
| Batch construction | `construct_bars(trades, config)` | `constructBars(trades, config)` |
| Streaming builder | `StreamingVolumeBarBuilder(config)` | `new StreamingVolumeBarBuilder(config)` |
| Load a trade tape | `load_trades(csv)` | `loadTrades(path)` |
| Errors | `VolumeBarsValidationError` | `VolumeBarsValidationError` |

## Edge cases & limitations

- **Overshoot by design:** a bar can exceed `targetVolume` because the crossing
  trade is not split.
- **Finalized input only:** corrections/cancels resolved upstream; duplicate ids
  and out-of-order trades are rejected.
- **One symbol / one currency per call.**
- **Contiguous sessions:** a session may not reappear after a later one begins.
- **`closePartial`** controls whether the trailing partial bar is emitted.

## Testing

**Python** (19 tests)

```bash
cd python && pip install -e ".[dev]" && pytest
```

**TypeScript** (18 tests, zero runtime dependencies)

```bash
cd typescript && npm install && npm test && npm run build
```

## Related algorithms

- `D01-F01-A01` — [Time Bars](https://github.com/IslamBaraka90/Fintech-Time-Bars-Bar-Construction-algorithm) · `A02` — [Tick Bars](https://github.com/IslamBaraka90/Fintech-Tick-Bars-Bar-Construction-algorithm)
- `D01-F01-A04` — Dollar Bars (same pattern on cumulative dollar value)
- `D01-F01-A05…A07` — Imbalance / Run bars

Full index: **[Awesome FinTech Algorithms](https://github.com/IslamBaraka90/Fintech-Algorithms-Awesome)**.

## License

[MIT](./LICENSE) © The Fintech Builder. Part of the
[100 FinTech Algorithms](https://thefintechbuilder.com) library.
