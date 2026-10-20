/**
 * The budgets the demo holds itself to.
 *
 * The byte budgets are the codec's own published limits: they come from the
 * package the demo depends on, so the demo cannot quietly widen them. The
 * timing budgets are the demo's own, and they are declared here so the run
 * prints the number it was measured against.
 */

import {
  MAX_PARTS_PER_UPDATE,
  MAX_REGIONS_PER_UPDATE,
  MAX_UPDATE_WIRE_BYTES,
} from "@tessellio/ts/parts";

export const BUDGETS = {
  /** The codec's own ceiling on one update's wire bytes. */
  maxUpdateBytes: MAX_UPDATE_WIRE_BYTES,
  /** The codec's own ceiling on the parts of one update. */
  maxParts: MAX_PARTS_PER_UPDATE,
  /** The codec's own ceiling on the regions of one update. */
  maxRegions: MAX_REGIONS_PER_UPDATE,
  /** The demo's budget for encoding one update, in milliseconds. */
  encodeMs: 100,
  /** The demo's budget for decoding and painting one update, in milliseconds. */
  decodeMs: 100,
} as const;
