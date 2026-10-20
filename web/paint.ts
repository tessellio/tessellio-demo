/**
 * Painting the surface from an update.
 *
 * The work is the codec's: the package's `SurfaceStream` assembles the parts
 * of an update, validates every region before the first cell is written, and
 * hands the validated op streams to the package's canvas renderer, which
 * paints them. This module supplies the parts, reads the result back, and
 * compares the painted surface with the capture the sender encoded.
 *
 * The headless run and the browser run use this same module, so what the
 * browser shows is what the headless run checked.
 */

import { CODEC_TESSELLIO, type UpdatePart } from "@tessellio/ts/parts";
import { buildRgb565Lut, type SurfaceCanvasRenderer } from "@tessellio/ts/surface";
import { SurfaceStream } from "@tessellio/ts/stream";

import type { Artifact, ArtifactUpdate } from "./types";
import { fromBase64 } from "./types";

/** The codec's canvas renderer, for the callers that paint on a canvas. */
export { SurfaceCanvasRenderer } from "@tessellio/ts/surface";

/** One update's paint latency, as the codec measured it. */
export type PaintLatency = {
  updateId: number;
  /** The time from the update's first part to the painted surface. */
  ms: number;
};

/** What the paint produced. */
export type PaintResult = {
  /** The update the surface holds. */
  updateId: number;
  /** The updates that were applied. */
  applied: number;
  /** The refusals the stream reported. */
  failures: number;
  /** The refusals, with their reasons. */
  reasons: string[];
  /** The per-update paint latency the codec measured. */
  latencies: PaintLatency[];
};

/** The package's part, built from the artifact's part. */
export function toUpdatePart(
  artifact: Artifact,
  update: ArtifactUpdate,
  part: ArtifactUpdate["partList"][number],
): UpdatePart {
  return {
    updateId: update.updateId,
    baseUpdateId: update.baseUpdateId,
    width: artifact.width,
    height: artifact.height,
    partIndex: part.partIndex,
    partCount: part.partCount,
    updateBytes: part.updateBytes,
    codec: CODEC_TESSELLIO,
    regions: part.regions.map((region) => ({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      payload: fromBase64(region.payload),
    })),
  };
}

/**
 * Apply every update of the artifact, in order.
 *
 * The renderer is the package's own canvas renderer; the caller supplies the
 * canvas it paints on. One stream applies every update: the stream holds the
 * surface, so a chained update is applied onto the update it continues.
 */
export async function paintUpdates(
  artifact: Artifact,
  renderer: SurfaceCanvasRenderer,
): Promise<PaintResult> {
  const reasons: string[] = [];
  const latencies: PaintLatency[] = [];
  const expected = artifact.updates.length;
  let applied = 0;
  let failures = 0;
  let updateId = 0;

  const settled = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    const settle = (): void => {
      if (applied + failures >= expected) {
        clearTimeout(timer);
        resolve();
      }
    };
    const stream = new SurfaceStream({
      renderer,
      onApplied: (report) => {
        applied += 1;
        updateId = report.updateId;
        if (report.hasRenderLatencyMs) {
          latencies.push({ updateId: report.updateId, ms: report.renderLatencyMs });
        }
        settle();
      },
      onFailure: (failure) => {
        failures += 1;
        reasons.push(`${failure.reason} (holding update ${failure.heldUpdateId})`);
        settle();
      },
    });
    for (const update of artifact.updates) {
      for (const part of update.partList) {
        stream.applyPart(toUpdatePart(artifact, update, part), {});
      }
    }
  });
  await settled;

  return { updateId, applied, failures, reasons, latencies };
}

/** The capture's cells, as the artifact carries them. */
export function sourceCells(artifact: Artifact): Uint16Array {
  const bytes = fromBase64(artifact.sourceCells);
  const cells = new Uint16Array(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < cells.length; index += 1) {
    cells[index] = view.getUint16(index * 2, true);
  }
  return cells;
}

/**
 * The pixels the capture must paint.
 *
 * The codec's own cell-to-pixel table decides them, so the comparison is
 * against the pixels the codec itself would paint for those cells.
 */
export function expectedPixels(artifact: Artifact): Uint8ClampedArray {
  const cells = sourceCells(artifact);
  const lut = buildRgb565Lut();
  const pixels = new Uint8ClampedArray(cells.length * 4);
  const view = new Uint32Array(pixels.buffer);
  for (let index = 0; index < cells.length; index += 1) {
    view[index] = lut[cells[index]];
  }
  return pixels;
}

/** The pixels that differ, and how many. */
export function comparePixels(
  painted: Uint8ClampedArray,
  expected: Uint8ClampedArray,
): { differing: number; first: number } {
  const length = Math.min(painted.length, expected.length);
  let differing = 0;
  let first = -1;
  for (let index = 0; index < length; index += 1) {
    if (painted[index] !== expected[index]) {
      differing += 1;
      if (first < 0) {
        first = index;
      }
    }
  }
  differing += Math.abs(painted.length - expected.length);
  return { differing, first };
}
