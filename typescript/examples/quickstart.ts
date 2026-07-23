/**
 * Quickstart: build Volume Bars from a trade tape, batch and streaming.
 *
 * Run:  node --experimental-strip-types examples/quickstart.ts
 */

import { constructBars, type Trade, type VolumeBarConfig } from "../src/bars.ts";
import { StreamingVolumeBarBuilder } from "../src/streaming.ts";

const config: VolumeBarConfig = { targetVolume: 1000, closePartial: true };
const specs: Array<[number, number]> = [[100, 400], [101, 350], [99, 500], [99.5, 600], [100.5, 400], [101, 250]];
const trades: Trade[] = specs.map(([price, volume], i) => ({
  tradeId: `W00${i + 1}`,
  timestamp: `2026-01-05T14:30:0${i}.000Z`,
  session: "2026-01-05",
  symbol: "SYNTH",
  price,
  volume,
  currency: "USD",
}));

// 1) Batch: a bar closes once cumulative volume >= 1000 (the crossing trade stays whole).
for (const bar of constructBars(trades, config)) {
  console.log(`bar ${bar.barIndex}: C${bar.close} vol=${bar.volume} ticks=${bar.tickCount} (${bar.closeReason})`);
}

// 2) Streaming: emit each bar the moment volume crosses the target.
console.log("--- streaming ---");
const builder = new StreamingVolumeBarBuilder(config);
for (const trade of trades) {
  for (const bar of builder.push(trade)) console.log(`closed bar on ${trade.tradeId} at volume ${bar.volume} (${bar.closeReason})`);
}
for (const bar of builder.flush()) console.log(`flushed partial bar vol=${bar.volume} (${bar.closeReason})`);
