/**
 * The demo's headless run: the same paint the browser does, without a browser.
 *
 * It is the demo's gate. It asserts that the surface the receiver painted from
 * the updates equals the capture the sender encoded, and it holds every
 * measurement against the budget it was measured against.
 */

import { HeadlessCanvas, installDomDoubles } from "../dist/canvas.mjs";
import { comparePixels, expectedPixels, paintUpdates, SurfaceCanvasRenderer } from "../dist/paint.mjs";
import { BUDGETS } from "../dist/budgets.mjs";
import { buildSender, runSender } from "./lib.mjs";

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

installDomDoubles();
buildSender();
const artifact = await runSender();

const canvas = new HeadlessCanvas();
const painted = await paintUpdates(artifact, new SurfaceCanvasRenderer(canvas));
const comparison = comparePixels(canvas.pixels(), expectedPixels(artifact));

console.log("the sender's updates");
for (const update of artifact.updates) {
  const phases = update.phases.map((phase) => `${phase.phase}=${phase.ms.toFixed(3)}ms`).join(" ");
  console.log(
    `  update ${update.updateId} (${update.kind}): ` +
      `bytes=${update.bytes} budget=${BUDGETS.maxUpdateBytes} ` +
      `changed_cells=${update.changedCells} regions=${update.regions} parts=${update.parts} ` +
      `encode=${update.encodeMs.toFixed(3)}ms budget=${BUDGETS.encodeMs}ms`,
  );
  console.log(`    phases: ${phases}`);
  check(
    update.bytes <= BUDGETS.maxUpdateBytes,
    `update ${update.updateId} carries ${update.bytes} bytes, over the budget of ${BUDGETS.maxUpdateBytes}`,
  );
  check(update.parts <= BUDGETS.maxParts, `update ${update.updateId} has ${update.parts} parts`);
  check(
    update.regions <= BUDGETS.maxRegions,
    `update ${update.updateId} has ${update.regions} regions`,
  );
  check(
    update.encodeMs <= BUDGETS.encodeMs,
    `update ${update.updateId} took ${update.encodeMs.toFixed(3)}ms, over the budget of ${BUDGETS.encodeMs}ms`,
  );
}

console.log("the receiver's paint");
for (const latency of painted.latencies) {
  console.log(
    `  update ${latency.updateId}: ${latency.ms.toFixed(3)}ms budget=${BUDGETS.decodeMs}ms`,
  );
  check(
    latency.ms <= BUDGETS.decodeMs,
    `update ${latency.updateId} took ${latency.ms.toFixed(3)}ms to paint, over the budget of ${BUDGETS.decodeMs}ms`,
  );
}
console.log(
  `  applied=${painted.applied} refused=${painted.failures} cells=${
    canvas.pixels().length / 4
  } differing=${comparison.differing}`,
);

check(painted.failures === 0, `the receiver refused an update: ${painted.reasons.join(", ")}`);
check(painted.applied === artifact.updates.length, "not every update was applied");
check(
  comparison.differing === 0,
  `the painted surface differs from the capture in ${comparison.differing} bytes (first at ${comparison.first})`,
);

console.log(
  `MEASURE tessellio-demo headless: applied=${painted.applied} refused=${painted.failures} ` +
    `cells=${canvas.pixels().length / 4} differing=${comparison.differing} ` +
    `bytes=${artifact.updates.map((update) => update.bytes).join(",")} ` +
    `budget_bytes=${BUDGETS.maxUpdateBytes}`,
);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  process.exit(1);
}
console.log("the painted surface matches the capture, and every measurement is inside its budget");
