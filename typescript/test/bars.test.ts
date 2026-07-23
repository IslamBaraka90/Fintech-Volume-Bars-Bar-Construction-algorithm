import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { VolumeBarsValidationError, constructBars, type Trade, type VolumeBarConfig } from "../src/bars.ts";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/worked_example.json", import.meta.url)), "utf8"),
);
const CONFIG: VolumeBarConfig = FIXTURE.config;
const TRADES: Trade[] = FIXTURE.trades;
const EXPECTED = FIXTURE.expectedBars;

test("worked example matches expected bars", () => {
  assert.deepEqual(constructBars(TRADES, CONFIG), EXPECTED);
});

test("whole-trade overshoot and exact equality", () => {
  const bars = constructBars(TRADES, CONFIG);
  assert.equal(bars[0].volume, 1250);
  assert.equal(bars[0].closeReason, "threshold");
  assert.equal(bars[1].volume, 1000);
  assert.equal(bars[1].closeReason, "threshold");
  assert.equal(bars[2].volume, 250);
  assert.equal(bars[2].closeReason, "stream_end");
});

test("closePartial=false drops the partial", () => {
  const bars = constructBars(TRADES, { ...CONFIG, closePartial: false });
  assert.deepEqual(
    bars.map((b) => b.closeReason),
    ["threshold", "threshold"],
  );
});

test("a single large trade closes immediately", () => {
  const bars = constructBars(TRADES.slice(0, 1), { targetVolume: 100 });
  assert.equal(bars.length, 1);
  assert.equal(bars[0].tickCount, 1);
  assert.equal(bars[0].closeReason, "threshold");
});

test("empty trades returns empty", () => {
  assert.deepEqual(constructBars([], CONFIG), []);
});

test("rejects non-positive target", () => {
  assert.throws(() => constructBars(TRADES, { targetVolume: 0 }), VolumeBarsValidationError);
});

test("rejects unordered trades", () => {
  assert.throws(() => constructBars([...TRADES].reverse(), CONFIG), VolumeBarsValidationError);
});

test("rejects duplicate trade id", () => {
  assert.throws(
    () => constructBars([TRADES[0], { ...TRADES[1], tradeId: "W001" }], CONFIG),
    VolumeBarsValidationError,
  );
});

test("rejects mixed symbol", () => {
  assert.throws(
    () => constructBars([TRADES[0], { ...TRADES[1], symbol: "OTHER" }], CONFIG),
    VolumeBarsValidationError,
  );
});

test("rejects non-contiguous session", () => {
  const a = { ...TRADES[0], session: "S1" };
  const b = { ...TRADES[1], session: "S2" };
  const c = { ...TRADES[2], session: "S1" };
  assert.throws(() => constructBars([a, b, c], CONFIG), VolumeBarsValidationError);
});
