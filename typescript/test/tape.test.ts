import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { constructBars, type VolumeBarConfig } from "../src/bars.ts";
import { loadTrades } from "../src/tape.ts";

const TAPE = fileURLToPath(new URL("./fixtures/trade_tape.csv", import.meta.url));
const CONFIG: VolumeBarConfig = { targetVolume: 1000, closePartial: true };

test("loadTrades parses the tape", () => {
  const trades = loadTrades(TAPE);
  assert.equal(trades.length, 6);
  assert.equal(trades[0].tradeId, "W001");
  assert.equal(trades[0].volume, 400);
  assert.equal(typeof trades[0].volume, "number");
});

test("constructBars over the loaded tape", () => {
  const bars = constructBars(loadTrades(TAPE), CONFIG);
  assert.deepEqual(
    bars.map((b) => b.volume),
    [1250, 1000, 250],
  );
  assert.equal(bars[0].dollarValue, 124850);
});
