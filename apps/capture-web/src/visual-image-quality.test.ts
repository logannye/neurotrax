import { describe, expect, it } from "vitest";
import { computeFaceImageQuality } from "./visual-image-quality.js";

function pixels(
  width: number,
  height: number,
  valueAt: (x: number, y: number) => number
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = valueAt(x, y);
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return data;
}

describe("computeFaceImageQuality", () => {
  it("reports normalized face-region luma and clipping fractions", () => {
    const data = pixels(2, 2, (x, y) =>
      x === 0 && y === 0 ? 0 : x === 1 && y === 0 ? 255 : 128
    );
    const quality = computeFaceImageQuality({
      data,
      width: 2,
      height: 2
    });

    expect(quality.illuminationMean).toBeCloseTo(
      (0 + 1 + 128 / 255 + 128 / 255) / 4
    );
    expect(quality.darkClippingFraction).toBe(0.25);
    expect(quality.brightClippingFraction).toBe(0.25);
  });

  it("uses normalized Laplacian variance as a sharpness signal", () => {
    const flat = computeFaceImageQuality({
      data: pixels(8, 8, () => 128),
      width: 8,
      height: 8
    });
    const checkerboard = computeFaceImageQuality({
      data: pixels(8, 8, (x, y) => ((x + y) % 2 === 0 ? 30 : 225)),
      width: 8,
      height: 8
    });

    expect(flat.sharpness).toBe(0);
    expect(checkerboard.sharpness).toBeGreaterThan(0.1);
  });
});
