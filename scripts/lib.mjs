/**
 * The demo's shared plumbing: where things live, how the sender is built, and
 * how it is run.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const rustDir = join(root, "rust");
export const publicDir = join(root, "public");
export const distDir = join(root, "dist");
export const artifactPath = join(publicDir, "artifact.json");
export const senderBinary = join(rustDir, "target", "release", "tessellio-demo-sender");

/** Build the sender: the demo's Rust half, the one that calls the codec. */
export function buildSender({ locked = false } = {}) {
  const args = ["build", "--release"];
  if (locked) {
    args.push("--locked");
  }
  const result = spawnSync("cargo", args, { cwd: rustDir, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`cargo build failed with status ${String(result.status)}`);
  }
}

/** Run the sender and read the artifact it wrote. */
export function runSender() {
  if (!existsSync(senderBinary)) {
    throw new Error(`the sender is not built: ${senderBinary} is missing`);
  }
  mkdirSync(publicDir, { recursive: true });
  const result = spawnSync(senderBinary, ["--out", artifactPath], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`the sender failed with status ${String(result.status)}`);
  }
  return JSON.parse(readFileSync(artifactPath, "utf8"));
}
