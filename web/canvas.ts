/**
 * The demo's canvas doubles.
 *
 * The codec's browser package paints a surface through the canvas API, and the
 * headless run needs the two DOM types a browser has and Node does not:
 * `ImageData` and a canvas. The doubles below are those types, and nothing
 * else: the codec's code runs against them unmodified.
 *
 * The canvas double implements the canvas API's own `putImageData` rule: the
 * dirty rectangle names a region of the image, and that region is copied to
 * the same place on the canvas, offset by the destination.
 */

/** The `ImageData` a browser has and Node does not. */
class HeadlessImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

/** Install the DOM types the headless run needs, if the host lacks them. */
export function installDomDoubles(): void {
  const scope = globalThis as unknown as { ImageData?: unknown };
  if (scope.ImageData === undefined) {
    scope.ImageData = HeadlessImageData;
  }
}

/** A canvas that keeps the pixels a context paints. */
export class HeadlessCanvas {
  private buffer = new Uint8ClampedArray(0);
  private pixelsWide = 0;
  private pixelsHigh = 0;

  get width(): number {
    return this.pixelsWide;
  }

  set width(value: number) {
    this.pixelsWide = value;
    this.reallocate();
  }

  get height(): number {
    return this.pixelsHigh;
  }

  set height(value: number) {
    this.pixelsHigh = value;
    this.reallocate();
  }

  /** The painted pixels, in RGBA order. */
  pixels(): Uint8ClampedArray {
    return this.buffer;
  }

  /** The browser's 2D context, with the canvas API's own semantics. */
  getContext(kind: string): unknown {
    if (kind !== "2d") {
      return null;
    }
    const canvas = this;
    return {
      fillStyle: "#000000",
      fillRect: (x: number, y: number, width: number, height: number): void => {
        for (let row = y; row < y + height; row += 1) {
          for (let column = x; column < x + width; column += 1) {
            const offset = (row * canvas.pixelsWide + column) * 4;
            if (offset < 0 || offset + 3 >= canvas.buffer.length) {
              continue;
            }
            canvas.buffer[offset] = 0;
            canvas.buffer[offset + 1] = 0;
            canvas.buffer[offset + 2] = 0;
            canvas.buffer[offset + 3] = 255;
          }
        }
      },
      putImageData: (
        image: { data: Uint8ClampedArray; width: number },
        dx: number,
        dy: number,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
      ): void => {
        for (let row = 0; row < sh; row += 1) {
          for (let column = 0; column < sw; column += 1) {
            const source = ((sy + row) * image.width + sx + column) * 4;
            const target = ((sy + row + dy) * canvas.pixelsWide + sx + column + dx) * 4;
            if (source < 0 || source + 3 >= image.data.length) {
              continue;
            }
            if (target < 0 || target + 3 >= canvas.buffer.length) {
              continue;
            }
            canvas.buffer[target] = image.data[source];
            canvas.buffer[target + 1] = image.data[source + 1];
            canvas.buffer[target + 2] = image.data[source + 2];
            canvas.buffer[target + 3] = image.data[source + 3];
          }
        }
      },
    };
  }

  private reallocate(): void {
    const size = Math.max(0, this.pixelsWide * this.pixelsHigh * 4);
    const grown = new Uint8ClampedArray(size);
    grown.set(this.buffer.subarray(0, Math.min(this.buffer.length, size)));
    this.buffer = grown;
  }
}
