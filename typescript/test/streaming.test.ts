import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { VolumeBarsValidationError, constructBars, type Trade, type VolumeBarConfig } from "../src/bars.ts";
import { StreamingVolumeBarBuilder } from "../src/streaming.ts";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/worked_example.json", import.meta.url)), "utf8"),
);
const CONFIG: VolumeBarConfig = FIXTURE.config;
const TRADES: Trade[] = FIXTURE.trades;

function stream(trades: Trade[], config: VolumeBarConfig) {
  const builder = new StreamingVolumeBarBuilder(config);
  const emitted = builder.pushMany(trades);
  emitted.push(...builder.flush());
  return emitted;
}

test("streaming matches batch", () => {
  assert.deepEqual(stream(TRADES, CONFIG), constructBars(TRADES, CONFIG));
});

test("streaming matches batch (closePartial=false)", () => {
  const config = { ...CONFIG, closePartial: false };
  assert.deepEqual(stream(TRADES, config), constructBars(TRADES, config));
});

test("push emits when volume crosses the target", () => {
  const builder = new StreamingVolumeBarBuilder(CONFIG);
  assert.deepEqual(builder.push(TRADES[0]), []); // 400
  assert.deepEqual(builder.push(TRADES[1]), []); // 750
  const closed = builder.push(TRADES[2]); // 1250 -> crosses
  assert.equal(closed.length, 1);
  assert.equal(closed[0].volume, 1250);
});

test("flush closes the final partial", () => {
  const builder = new StreamingVolumeBarBuilder(CONFIG);
  builder.pushMany(TRADES);
  const final = builder.flush();
  assert.equal(final.length, 1);
  assert.equal(final[0].closeReason, "stream_end");
});

test("cannot push after flush", () => {
  const builder = new StreamingVolumeBarBuilder(CONFIG);
  builder.pushMany(TRADES);
  builder.flush();
  assert.throws(() => builder.push(TRADES[0]), VolumeBarsValidationError);
});

test("streaming validates incrementally", () => {
  const builder = new StreamingVolumeBarBuilder(CONFIG);
  builder.push(TRADES[0]);
  assert.throws(() => builder.push({ ...TRADES[1], tradeId: "W001" }), VolumeBarsValidationError);
});
