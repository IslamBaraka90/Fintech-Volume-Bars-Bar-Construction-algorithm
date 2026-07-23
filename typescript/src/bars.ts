/**
 * Whole-trade, session-reset Volume Bars.
 *
 * A faithful, cross-language twin of the Python `fintech_volume_bars.core` module
 * and of the reference algorithm published at The Fintech Builder (topic
 * `D01-F01-A03`). A volume bar closes at the first trade whose arrival makes the
 * bar's cumulative volume reach `targetVolume`:
 *
 *     close bar B at the first trade for which (sum of volumes in B) >= targetVolume
 *
 * The crossing trade stays whole (the bar may overshoot); overshoot is neither
 * split nor carried numerically to the next bar. Session changes reset state.
 */

export class VolumeBarsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VolumeBarsValidationError";
  }
}

export interface Trade {
  tradeId: string;
  timestamp: string;
  session: string;
  symbol: string;
  price: number;
  volume: number;
  currency: string;
}

export interface VolumeBarConfig {
  targetVolume: number;
  closePartial?: boolean;
}

export type CloseReason = "threshold" | "session_end" | "stream_end";

export interface VolumeBar {
  barIndex: number;
  session: string;
  startTime: string;
  endTime: string;
  lastTradeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dollarValue: number;
  tickCount: number;
  firstTradeId: string;
  lastTradeId: string;
  closeReason: CloseReason;
}

export type State = Omit<VolumeBar, "barIndex" | "endTime" | "closeReason">;

export const REQUIRED_FIELDS: (keyof Trade)[] = [
  "tradeId", "timestamp", "session", "symbol", "price", "volume", "currency",
];

export function timestampMs(value: unknown): number {
  if (typeof value !== "string" || !value.endsWith("Z")) {
    throw new VolumeBarsValidationError("timestamp must be an ISO-8601 UTC string ending in Z");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new VolumeBarsValidationError("timestamp must be a valid ISO-8601 UTC string");
  return parsed;
}

export function positiveFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new VolumeBarsValidationError(`${field} must be a finite positive number`);
  }
  return value;
}

export function rounded(value: number): number {
  return Number(value.toFixed(8));
}

export function start(trade: Trade): State {
  return {
    session: trade.session,
    startTime: trade.timestamp,
    lastTradeTime: trade.timestamp,
    open: trade.price,
    high: trade.price,
    low: trade.price,
    close: trade.price,
    volume: trade.volume,
    dollarValue: trade.price * trade.volume,
    tickCount: 1,
    firstTradeId: trade.tradeId,
    lastTradeId: trade.tradeId,
  };
}

export function add(state: State, trade: Trade): void {
  state.lastTradeTime = trade.timestamp;
  state.high = Math.max(state.high, trade.price);
  state.low = Math.min(state.low, trade.price);
  state.close = trade.price;
  state.volume += trade.volume;
  state.dollarValue += trade.price * trade.volume;
  state.tickCount += 1;
  state.lastTradeId = trade.tradeId;
}

export function toBar(current: State, barIndex: number, closeReason: CloseReason): VolumeBar {
  return {
    barIndex,
    session: current.session,
    startTime: current.startTime,
    endTime: current.lastTradeTime,
    lastTradeTime: current.lastTradeTime,
    open: rounded(current.open),
    high: rounded(current.high),
    low: rounded(current.low),
    close: rounded(current.close),
    volume: rounded(current.volume),
    dollarValue: rounded(current.dollarValue),
    tickCount: current.tickCount,
    firstTradeId: current.firstTradeId,
    lastTradeId: current.lastTradeId,
    closeReason,
  };
}

export function validate(trades: Trade[], config: VolumeBarConfig): { target: number; closePartial: boolean } {
  if (!Array.isArray(trades)) throw new VolumeBarsValidationError("trades must be an array");
  if (!config || typeof config !== "object") throw new VolumeBarsValidationError("config must be an object");
  const target = positiveFinite(config.targetVolume, "targetVolume");
  const closePartial = config.closePartial ?? true;
  if (typeof closePartial !== "boolean") throw new VolumeBarsValidationError("closePartial must be boolean");

  const ids = new Set<string>();
  const finishedSessions = new Set<string>();
  let previousTime = -Infinity;
  let currentSession: string | null = null;
  let symbol: string | null = null;
  let currency: string | null = null;

  trades.forEach((trade, position) => {
    if (!trade || typeof trade !== "object" || REQUIRED_FIELDS.some((field) => !(field in trade))) {
      throw new VolumeBarsValidationError(`trade at position ${position} is missing a required field`);
    }
    for (const field of ["tradeId", "session", "symbol", "currency"] as const) {
      if (typeof trade[field] !== "string" || trade[field].length === 0) {
        throw new VolumeBarsValidationError(`${field} must be a non-empty string`);
      }
    }
    const eventTime = timestampMs(trade.timestamp);
    if (eventTime < previousTime) throw new VolumeBarsValidationError("trades must be globally chronological");
    previousTime = eventTime;
    if (ids.has(trade.tradeId)) throw new VolumeBarsValidationError("tradeId must be unique after corrections and cancels");
    ids.add(trade.tradeId);
    positiveFinite(trade.price, "price");
    positiveFinite(trade.volume, "volume");

    symbol ??= trade.symbol;
    currency ??= trade.currency;
    if (trade.symbol !== symbol) throw new VolumeBarsValidationError("all trades in one call must have the same symbol");
    if (trade.currency !== currency) throw new VolumeBarsValidationError("all trades in one call must have the same currency");

    if (currentSession !== null && trade.session !== currentSession) {
      finishedSessions.add(currentSession);
      if (finishedSessions.has(trade.session)) {
        throw new VolumeBarsValidationError("each session must occupy one contiguous input block");
      }
    }
    currentSession = trade.session;
  });
  return { target, closePartial };
}

export function constructBars(trades: Trade[], config: VolumeBarConfig): VolumeBar[] {
  const { target, closePartial } = validate(trades, config);
  const bars: VolumeBar[] = [];
  let state: State | null = null;
  let session: string | null = null;

  for (const trade of trades) {
    if (session !== null && trade.session !== session) {
      if (state !== null && closePartial) bars.push(toBar(state, bars.length, "session_end"));
      state = null;
    }
    session = trade.session;
    if (state === null) state = start(trade);
    else add(state, trade);
    if (state.volume >= target) {
      bars.push(toBar(state, bars.length, "threshold"));
      state = null;
    }
  }
  if (state !== null && closePartial) bars.push(toBar(state, bars.length, "stream_end"));
  return bars;
}
