/**
 * The demo's browser page: the capture the sender encoded, the surface the
 * receiver painted from it, and what each update cost.
 */

import { buildRgb565Lut, SurfaceCanvasRenderer } from "@tessellio/ts/surface";

import { BUDGETS } from "./budgets";
import { comparePixels, expectedPixels, paintUpdates, sourceCells } from "./paint";
import type { Artifact } from "./types";

const artifactResponse = await fetch("./artifact.json");
if (!artifactResponse.ok) {
  throw new Error(`the artifact is not there: ${artifactResponse.status}`);
}
const artifact = (await artifactResponse.json()) as Artifact;

const surface = document.getElementById("surface") as HTMLCanvasElement;
const capture = document.getElementById("capture") as HTMLCanvasElement;
const report = document.getElementById("report") as HTMLPreElement;

surface.width = artifact.width;
surface.height = artifact.height;
capture.width = artifact.width;
capture.height = artifact.height;

/** The capture, drawn through the codec's own cell-to-pixel table. */
function drawCapture(): void {
  const cells = sourceCells(artifact);
  const lut = buildRgb565Lut();
  const pixels = new Uint8ClampedArray(artifact.width * artifact.height * 4);
  const view = new Uint32Array(pixels.buffer);
  for (let index = 0; index < cells.length && index < view.length; index += 1) {
    view[index] = lut[cells[index]];
  }
  const context = capture.getContext("2d");
  if (context !== null) {
    context.putImageData(new ImageData(pixels, artifact.width, artifact.height), 0, 0);
  }
}

drawCapture();

const started = performance.now();
const painted = await paintUpdates(artifact, new SurfaceCanvasRenderer(surface));
const totalMs = performance.now() - started;

const context = surface.getContext("2d");
const actual = context === null ? new Uint8ClampedArray(0) : context.getImageData(0, 0, artifact.width, artifact.height).data;
const comparison = comparePixels(actual, expectedPixels(artifact));

const lines: string[] = [];
lines.push(`codec            ${artifact.codec}`);
lines.push(`capture          ${artifact.width} x ${artifact.height} cells`);
lines.push("");
lines.push("update  kind      bytes / budget        cells changed  regions  parts   encode / budget");
for (const update of artifact.updates) {
  const bytes = `${update.bytes} / ${BUDGETS.maxUpdateBytes}`;
  const encode = `${update.encodeMs.toFixed(3)} ms / ${BUDGETS.encodeMs} ms`;
  lines.push(
    `${String(update.updateId).padStart(5)}  ${update.kind.padEnd(8)}  ${bytes.padEnd(18)}  ${String(
      update.changedCells,
    ).padStart(12)}  ${String(update.regions).padStart(7)}  ${String(update.parts).padStart(5)}  ${encode}`,
  );
}
lines.push("");
lines.push("the sender's encode phases (milliseconds)");
for (const update of artifact.updates) {
  const phases = update.phases.map((phase) => `${phase.phase} ${phase.ms.toFixed(3)}`).join("  ");
  lines.push(`  update ${update.updateId}: ${phases}`);
}
lines.push("");
lines.push("the receiver's paint (milliseconds)");
for (const latency of painted.latencies) {
  lines.push(
    `  update ${latency.updateId}: ${latency.ms.toFixed(3)} ms / ${BUDGETS.decodeMs} ms budget`,
  );
}
lines.push(`  total: ${totalMs.toFixed(3)} ms`);
lines.push("");
lines.push(
  painted.failures === 0
    ? `the surface holds update ${painted.updateId}; ${painted.applied} updates applied, 0 refused`
    : `the surface holds update ${painted.updateId}; refusals: ${painted.reasons.join(", ")}`,
);
lines.push(
  comparison.differing === 0
    ? `the painted surface matches the capture: ${actual.length / 4} cells identical`
    : `the painted surface differs from the capture: ${comparison.differing} bytes (first at ${comparison.first})`,
);
report.textContent = lines.join("\n");

console.log(
  `MEASURE tessellio-demo: applied=${painted.applied} refused=${painted.failures} ` +
    `cells=${actual.length / 4} differing=${comparison.differing} ` +
    `decode_ms=${totalMs.toFixed(3)} budget_ms=${BUDGETS.decodeMs}`,
);
