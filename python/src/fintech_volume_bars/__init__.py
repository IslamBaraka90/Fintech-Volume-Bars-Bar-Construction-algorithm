"""Fintech Volume Bars — activity-clock bar construction.

A small, well-specified, cross-language reference implementation of Volume Bars:
aggregating a finalized trade tape into bars that each accumulate at least
``targetVolume`` traded units (the crossing trade stays whole).

Companion article (canonical): https://thefintechbuilder.com/market-data-engineering/bar-construction/volume-bars/
Catalog topic id: D01-F01-A03  (Domain D01 — Market Data Engineering / Family D01-F01 — Bar Construction)
"""

from __future__ import annotations

from .core import VolumeBarsValidationError, construct_bars
from .streaming import StreamingVolumeBarBuilder
from .yahoo import load_trades

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "VolumeBarsValidationError",
    "construct_bars",
    "StreamingVolumeBarBuilder",
    "load_trades",
]
