"""Stateful, streaming Volume-Bar builder.

:func:`~fintech_volume_bars.core.construct_bars` aggregates a whole tape at once.
A live tape needs a builder that accepts one trade at a time and emits a bar the
instant cumulative volume reaches the target (or a session ends, or the stream is
flushed).

``StreamingVolumeBarBuilder`` is that object. Feed trades with :meth:`push` (it
returns any bars closed by that trade — usually zero or one); call :meth:`flush`
at end of stream. It validates each trade incrementally and produces
byte-identical bars to the batch kernel.
"""

from __future__ import annotations

from typing import Any

from .core import (
    REQUIRED_FIELDS,
    VolumeBarsValidationError,
    _add,
    _bar,
    _positive_finite,
    _start,
    _timestamp,
)

__all__ = ["StreamingVolumeBarBuilder"]


class StreamingVolumeBarBuilder:
    """Incremental whole-trade volume-bar builder.

    Examples
    --------
    >>> builder = StreamingVolumeBarBuilder({"targetVolume": 1000})
    >>> closed = builder.push_many(tape) + builder.flush()   # doctest: +SKIP
    """

    def __init__(self, config: dict[str, Any]) -> None:
        if not isinstance(config, dict):
            raise VolumeBarsValidationError("config must be an object")
        self._target = _positive_finite(config.get("targetVolume"), "targetVolume")
        close_partial = config.get("closePartial", True)
        if not isinstance(close_partial, bool):
            raise VolumeBarsValidationError("closePartial must be boolean")
        self._close_partial = close_partial

        # validation state
        self._prev_time = None
        self._ids: set[str] = set()
        self._finished_sessions: set[str] = set()
        self._active_session: str | None = None
        self._symbol: str | None = None
        self._currency: str | None = None

        # aggregation state
        self._state: dict[str, Any] | None = None
        self._session: str | None = None
        self._bar_count = 0
        self._flushed = False

    def _validate_trade(self, trade: object) -> None:
        if not isinstance(trade, dict) or any(field not in trade for field in REQUIRED_FIELDS):
            raise VolumeBarsValidationError("trade is missing a required field")
        for field in ("tradeId", "session", "symbol", "currency"):
            if not isinstance(trade[field], str) or not trade[field]:
                raise VolumeBarsValidationError(f"{field} must be a non-empty string")

        event_time = _timestamp(trade["timestamp"])
        if self._prev_time is not None and event_time < self._prev_time:
            raise VolumeBarsValidationError("trades must be globally chronological")
        self._prev_time = event_time

        if trade["tradeId"] in self._ids:
            raise VolumeBarsValidationError("tradeId must be unique after corrections and cancels")
        self._ids.add(trade["tradeId"])
        _positive_finite(trade["price"], "price")
        _positive_finite(trade["volume"], "volume")

        self._symbol = trade["symbol"] if self._symbol is None else self._symbol
        self._currency = trade["currency"] if self._currency is None else self._currency
        if trade["symbol"] != self._symbol:
            raise VolumeBarsValidationError("all trades in one call must have the same symbol")
        if trade["currency"] != self._currency:
            raise VolumeBarsValidationError("all trades in one call must have the same currency")

        trade_session = trade["session"]
        if self._active_session is not None and trade_session != self._active_session:
            self._finished_sessions.add(self._active_session)
            if trade_session in self._finished_sessions:
                raise VolumeBarsValidationError("each session must occupy one contiguous input block")
        self._active_session = trade_session

    def push(self, trade: dict[str, Any]) -> list[dict[str, Any]]:
        """Accept one trade and return any bars it closes (usually 0 or 1)."""
        if self._flushed:
            raise VolumeBarsValidationError("cannot push after flush()")
        self._validate_trade(trade)
        emitted: list[dict[str, Any]] = []

        if self._session is not None and trade["session"] != self._session:
            if self._state is not None and self._close_partial:
                emitted.append(_bar(self._state, self._bar_count, "session_end"))
                self._bar_count += 1
            self._state = None
        self._session = trade["session"]

        if self._state is None:
            self._state = _start(trade)
        else:
            _add(self._state, trade)

        if self._state["volume"] >= self._target:
            emitted.append(_bar(self._state, self._bar_count, "threshold"))
            self._bar_count += 1
            self._state = None
        return emitted

    def push_many(self, trades: object) -> list[dict[str, Any]]:
        """Feed an iterable of trades, returning every bar closed along the way."""
        try:
            iterator = iter(trades)  # type: ignore[arg-type]
        except TypeError as error:
            raise VolumeBarsValidationError("trades must be an iterable.") from error
        emitted: list[dict[str, Any]] = []
        for trade in iterator:
            emitted.extend(self.push(trade))
        return emitted

    def flush(self) -> list[dict[str, Any]]:
        """Close the final partial bar (if ``closePartial``) and end the stream."""
        self._flushed = True
        if self._state is not None and self._close_partial:
            bar = _bar(self._state, self._bar_count, "stream_end")
            self._bar_count += 1
            self._state = None
            return [bar]
        return []
