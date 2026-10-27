import { describe, expect, it } from "vitest";

import { stripGeometry, type StripLayout } from "./strip-prefs";

function layout(orientation: StripLayout["orientation"], size: StripLayout["size"]): StripLayout {
  return { order: [], orientation, size };
}

describe("stripGeometry (WU-R matrix: orientation-specific widths, thin vertical refresh)", () => {
  it("horizontal: one row, refresh rides the width, height is the segment height", () => {
    // 1 provider: PAD_X 16 + 160 + refresh 44 = 220.
    expect(stripGeometry(layout("horizontal", "normal"), 1)).toEqual({ width: 220, height: 48 });
    // 3 providers: 16 + 3*160 + 44 = 540.
    expect(stripGeometry(layout("horizontal", "normal"), 3)).toEqual({ width: 540, height: 48 });
    // XL: segments 210 wide, row height 68.
    expect(stripGeometry(layout("horizontal", "xl"), 2)).toEqual({ width: 480, height: 68 });
  });

  it("vertical: narrow 140px column, refresh rides BELOW as a thin 30px band", () => {
    // 1 provider + thin refresh: width 16 + 140 = 156, height 16 + 48 + 30 = 94.
    expect(stripGeometry(layout("vertical", "normal"), 1)).toEqual({ width: 156, height: 94 });
    // 3 providers + thin refresh: 16 + 3*48 + 30 = 190 tall, still narrow.
    expect(stripGeometry(layout("vertical", "normal"), 3)).toEqual({ width: 156, height: 190 });
    // XL vertical: 190 wide, 16 + 3*68 + 30 = 250 tall.
    expect(stripGeometry(layout("vertical", "xl"), 3)).toEqual({ width: 206, height: 250 });
  });

  it("treats an empty strip as one hint segment", () => {
    expect(stripGeometry(layout("horizontal", "normal"), 0)).toEqual({ width: 220, height: 48 });
    expect(stripGeometry(layout("vertical", "normal"), 0)).toEqual({ width: 156, height: 94 });
  });
});
