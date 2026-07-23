/**
 * Fintech Volume Bars — activity-clock bar construction.
 *
 * Companion article (canonical): https://thefintechbuilder.com/market-data-engineering/bar-construction/volume-bars/
 * Catalog topic id: D01-F01-A03 (Domain D01 — Market Data Engineering / Family D01-F01 — Bar Construction)
 */

export {
  VolumeBarsValidationError,
  constructBars,
  type Trade,
  type VolumeBarConfig,
  type VolumeBar,
  type CloseReason,
} from "./bars.ts";
export { StreamingVolumeBarBuilder } from "./streaming.ts";
export { loadTrades } from "./tape.ts";
