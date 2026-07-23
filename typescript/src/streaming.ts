/**
 * Stateful, streaming Volume-Bar builder.
 *
 * `./bars`'s `constructBars` aggregates a whole tape at once. A live tape needs a
 * builder that accepts one trade at a time and emits a bar the instant cumulative
 * volume reaches the target. `StreamingVolumeBarBuilder` does that: `push` returns
 * any bars closed by that trade (usually 0 or 1); `flush` closes the final
 * partial. It validates each trade incrementally and produces byte-identical bars.
 */

import {
  add,
  positiveFinite,
  REQUIRED_FIELDS,
  start,
  timestampMs,
  toBar,
  VolumeBarsValidationError,
  type State,
  type Trade,
  type VolumeBar,
  type VolumeBarConfig,
} from "./bars.ts";

export class StreamingVolumeBarBuilder {
  private readonly target: number;
  private readonly closePartial: boolean;

  // validation state
  private prevTime = -Infinity;
  private ids = new Set<string>();
  private finishedSessions = new Set<string>();
  private activeSession: string | null = null;
  private symbol: string | null = null;
  private currency: string | null = null;

  // aggregation state
  private state: State | null = null;
  private session: string | null = null;
  private barCount = 0;
  private flushed = false;

  constructor(config: VolumeBarConfig) {
    if (!config || typeof config !== "object") throw new VolumeBarsValidationError("config must be an object");
    this.target = positiveFinite(config.targetVolume, "targetVolume");
    const closePartial = config.closePartial ?? true;
    if (typeof closePartial !== "boolean") throw new VolumeBarsValidationError("closePartial must be boolean");
    this.closePartial = closePartial;
  }

  private validateTrade(raw: unknown): Trade {
    if (!raw || typeof raw !== "object" || REQUIRED_FIELDS.some((field) => !(field in (raw as object)))) {
      throw new VolumeBarsValidationError("trade is missing a required field");
    }
    const trade = raw as Trade;
    for (const field of ["tradeId", "session", "symbol", "currency"] as const) {
      if (typeof trade[field] !== "string" || trade[field].length === 0) {
        throw new VolumeBarsValidationError(`${field} must be a non-empty string`);
      }
    }
    const eventTime = timestampMs(trade.timestamp);
    if (eventTime < this.prevTime) throw new VolumeBarsValidationError("trades must be globally chronological");
    this.prevTime = eventTime;
    if (this.ids.has(trade.tradeId)) throw new VolumeBarsValidationError("tradeId must be unique after corrections and cancels");
    this.ids.add(trade.tradeId);
    positiveFinite(trade.price, "price");
    positiveFinite(trade.volume, "volume");

    this.symbol ??= trade.symbol;
    this.currency ??= trade.currency;
    if (trade.symbol !== this.symbol) throw new VolumeBarsValidationError("all trades in one call must have the same symbol");
    if (trade.currency !== this.currency) throw new VolumeBarsValidationError("all trades in one call must have the same currency");

    if (this.activeSession !== null && trade.session !== this.activeSession) {
      this.finishedSessions.add(this.activeSession);
      if (this.finishedSessions.has(trade.session)) {
        throw new VolumeBarsValidationError("each session must occupy one contiguous input block");
      }
    }
    this.activeSession = trade.session;
    return trade;
  }

  /** Accept one trade and return any bars it closes (usually 0 or 1). */
  push(rawTrade: Trade): VolumeBar[] {
    if (this.flushed) throw new VolumeBarsValidationError("cannot push after flush()");
    const trade = this.validateTrade(rawTrade);
    const emitted: VolumeBar[] = [];

    if (this.session !== null && trade.session !== this.session) {
      if (this.state !== null && this.closePartial) {
        emitted.push(toBar(this.state, this.barCount, "session_end"));
        this.barCount += 1;
      }
      this.state = null;
    }
    this.session = trade.session;

    if (this.state === null) this.state = start(trade);
    else add(this.state, trade);

    if (this.state.volume >= this.target) {
      emitted.push(toBar(this.state, this.barCount, "threshold"));
      this.barCount += 1;
      this.state = null;
    }
    return emitted;
  }

  /** Feed an array of trades, returning every bar closed along the way. */
  pushMany(trades: readonly Trade[]): VolumeBar[] {
    const emitted: VolumeBar[] = [];
    for (const trade of trades) emitted.push(...this.push(trade));
    return emitted;
  }

  /** Close the final partial bar (if `closePartial`) and end the stream. */
  flush(): VolumeBar[] {
    this.flushed = true;
    if (this.state !== null && this.closePartial) {
      const bar = toBar(this.state, this.barCount, "stream_end");
      this.barCount += 1;
      this.state = null;
      return [bar];
    }
    return [];
  }
}
