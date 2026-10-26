import { describe, expect, it } from "vitest";

import { stripGeometry, type StripLayout } from "./strip-prefs";

function layout(orientation: StripLayout["orientation"], size: StripLayout["size"]): StripLayout {
  return { order: [], orientation, size };
}

describe("stripGeometry (WU-N matrix)", () => {
  it("horizontal: one row, refresh rides the width, height is the segment height", () => {
    // 1 provider: PAD_X 16 + 180 + refresh 44 = 240.
    expect(stripGeometry(layout("horizontal", "normal"), 1)).toEqual({ width: 240, height: 48 });
    // 3 providers: 16 + 3*180 + 44 = 600.
    expect(stripGeometry(layout("horizontal", "normal"), 3)).toEqual({ width: 600, height: 48 });
    // XL: segments 230 wide, row height 68.
    expect(stripGeometry(layout("horizontal", "xl"), 2)).toEqual({ width: 520, height: 68 });
  });

  it("vertical: one column, refresh rides BELOW, width is one segment wide", () => {
    // 1 provider + refresh row: width 196, height 16 + 2*48 = 112.
    expect(stripGeometry(layout("vertical", "normal"), 1)).toEqual({ width: 196, height: 112 });
    // 3 providers + refresh row: 16 + 4*48 = 208 tall, still narrow.
    expect(stripGeometry(layout("vertical", "normal"), 3)).toEqual({ width: 196, height: 208 });
    // XL: 16 + 4*68 = 288 tall with 3 providers.
    expect(stripGeometry(layout("vertical", "xl"), 3)).toEqual({ width: 246, height: 288 });
  });

  it("treats an empty strip as one hint segment", () => {
    expect(stripGeometry(layout("horizontal", "normal"), 0)).toEqual({ width: 240, height: 48 });
    expect(stripGeometry(layout("vertical", "normal"), 0)).toEqual({ width: 196, height: 112 });
  });
});
