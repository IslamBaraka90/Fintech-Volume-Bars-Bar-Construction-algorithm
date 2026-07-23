"""Whole-trade, session-reset Volume Bars.

Faithful to the reference algorithm published at The Fintech Builder (topic
``D01-F01-A03``). A **volume bar** closes at the first trade whose arrival makes
the bar's cumulative volume reach ``targetVolume`` — an activity clock keyed to
traded size rather than to the wall clock or the tick count.

    V_j = sum of trade volumes in bar B_j
    close B_j at the first trade for which V_j >= targetVolume

This package uses the **whole-trade** convention: the threshold-crossing trade
stays entirely in the closing bar, so a bar can *overshoot* the target. Overshoot
is neither split nor carried numerically into the next bar. Session changes reset
membership. Input order is authoritative and must already be one cleaned stream.
"""

from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Any

__all__ = ["VolumeBarsValidationError", "construct_bars"]

REQUIRED_FIELDS = ("tradeId", "timestamp", "session", "symbol", "price", "volume", "currency")


class VolumeBarsValidationError(ValueError):
    """Raised when trades or config violate the Volume Bars contract."""


def _timestamp(value: Any) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise VolumeBarsValidationError("timestamp must be an ISO-8601 UTC string ending in Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise VolumeBarsValidationError("timestamp must be a valid ISO-8601 UTC string") from exc
    return parsed.astimezone(timezone.utc)


def _positive_finite(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise VolumeBarsValidationError(f"{field} must be a finite positive number")
    result = float(value)
    if not isfinite(result) or result <= 0:
        raise VolumeBarsValidationError(f"{field} must be a finite positive number")
    return result


def _validate(trades: list[dict[str, Any]], config: dict[str, Any]) -> tuple[float, bool]:
    if not isinstance(trades, list):
        raise VolumeBarsValidationError("trades must be a list")
    if not isinstance(config, dict):
        raise VolumeBarsValidationError("config must be an object")

    target = _positive_finite(config.get("targetVolume"), "targetVolume")
    close_partial = config.get("closePartial", True)
    if not isinstance(close_partial, bool):
        raise VolumeBarsValidationError("closePartial must be boolean")

    previous_time: datetime | None = None
    current_session: str | None = None
    finished_sessions: set[str] = set()
    seen_ids: set[str] = set()
    symbol: str | None = None
    currency: str | None = None

    for position, trade in enumerate(trades):
        if not isinstance(trade, dict) or any(field not in trade for field in REQUIRED_FIELDS):
            raise VolumeBarsValidationError(f"trade at position {position} is missing a required field")
        for field in ("tradeId", "session", "symbol", "currency"):
            if not isinstance(trade[field], str) or not trade[field]:
                raise VolumeBarsValidationError(f"{field} must be a non-empty string")

        event_time = _timestamp(trade["timestamp"])
        if previous_time is not None and event_time < previous_time:
            raise VolumeBarsValidationError("trades must be globally chronological")
        previous_time = event_time

        trade_id = trade["tradeId"]
        if trade_id in seen_ids:
            raise VolumeBarsValidationError("tradeId must be unique after corrections and cancels")
        seen_ids.add(trade_id)

        _positive_finite(trade["price"], "price")
        _positive_finite(trade["volume"], "volume")

        symbol = trade["symbol"] if symbol is None else symbol
        currency = trade["currency"] if currency is None else currency
        if trade["symbol"] != symbol:
            raise VolumeBarsValidationError("all trades in one call must have the same symbol")
        if trade["currency"] != currency:
            raise VolumeBarsValidationError("all trades in one call must have the same currency")

        trade_session = trade["session"]
        if current_session is not None and trade_session != current_session:
            finished_sessions.add(current_session)
            if trade_session in finished_sessions:
                raise VolumeBarsValidationError("each session must occupy one contiguous input block")
        current_session = trade_session

    return target, close_partial


def _rounded(value: float) -> float:
    return round(value + 0.0, 8)


def _start(trade: dict[str, Any]) -> dict[str, Any]:
    price = float(trade["price"])
    volume = float(trade["volume"])
    return {
        "session": trade["session"],
        "startTime": trade["timestamp"],
        "lastTradeTime": trade["timestamp"],
        "open": price,
        "high": price,
        "low": price,
        "close": price,
        "volume": volume,
        "dollarValue": price * volume,
        "tickCount": 1,
        "firstTradeId": trade["tradeId"],
        "lastTradeId": trade["tradeId"],
    }


def _add(current: dict[str, Any], trade: dict[str, Any]) -> None:
    price = float(trade["price"])
    volume = float(trade["volume"])
    current["lastTradeTime"] = trade["timestamp"]
    current["high"] = max(current["high"], price)
    current["low"] = min(current["low"], price)
    current["close"] = price
    current["volume"] += volume
    current["dollarValue"] += price * volume
    current["tickCount"] += 1
    current["lastTradeId"] = trade["tradeId"]


def _bar(current: dict[str, Any], bar_index: int, reason: str) -> dict[str, Any]:
    return {
        "barIndex": bar_index,
        "session": current["session"],
        "startTime": current["startTime"],
        "endTime": current["lastTradeTime"],
        "lastTradeTime": current["lastTradeTime"],
        "open": _rounded(current["open"]),
        "high": _rounded(current["high"]),
        "low": _rounded(current["low"]),
        "close": _rounded(current["close"]),
        "volume": _rounded(current["volume"]),
        "dollarValue": _rounded(current["dollarValue"]),
        "tickCount": current["tickCount"],
        "firstTradeId": current["firstTradeId"],
        "lastTradeId": current["lastTradeId"],
        "closeReason": reason,
    }


def construct_bars(trades: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    """Construct causal volume bars under the whole-trade convention."""
    target, close_partial = _validate(trades, config)
    if not trades:
        return []

    bars: list[dict[str, Any]] = []
    state: dict[str, Any] | None = None
    session: str | None = None

    for trade in trades:
        if session is not None and trade["session"] != session:
            if state is not None and close_partial:
                bars.append(_bar(state, len(bars), "session_end"))
            state = None
        session = trade["session"]

        if state is None:
            state = _start(trade)
        else:
            _add(state, trade)

        if state["volume"] >= target:
            bars.append(_bar(state, len(bars), "threshold"))
            state = None

    if state is not None and close_partial:
        bars.append(_bar(state, len(bars), "stream_end"))
    return bars
