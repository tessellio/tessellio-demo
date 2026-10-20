/**
 * The demo's artifact: what the sender produced, in the shape the browser
 * reads it.
 *
 * The document is written by the demo's sender (the Rust binary under `rust/`),
 * which encodes the capture with the published codec. Nothing in it is
 * invented here: every number is what the codec measured.
 */

export type ArtifactRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The region's raw-DEFLATE op stream, base64. */
  payload: string;
};

export type ArtifactPart = {
  partIndex: number;
  partCount: number;
  /** The payload bytes of the whole update, over all of its parts. */
  updateBytes: number;
  regions: ArtifactRegion[];
};

export type ArtifactUpdate = {
  updateId: number;
  baseUpdateId: number;
  kind: string;
  changedCells: number;
  sentCells: number;
  bytes: number;
  regions: number;
  parts: number;
  encodeMs: number;
  phases: { phase: string; ms: number }[];
  partList: ArtifactPart[];
};

export type Artifact = {
  codec: string;
  width: number;
  height: number;
  /** The capture's cells — the surface the updates must paint. Base64. */
  sourceCells: string;
  updates: ArtifactUpdate[];
};

/** Decode a base64 string into bytes. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
