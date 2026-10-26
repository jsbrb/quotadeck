// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { stripGeometry, type StripLayout } from "./strip-prefs";
import { applyLayoutToBar } from "./strip-view";

function layout(orientation: StripLayout["orientation"], size: StripLayout["size"]): StripLayout {
  return { order: [], orientation, size };
}

describe("applyLayoutToBar (WU-O regression suite: live toggles)", () => {
  it("horizontal normal: row classless bar, full height", () => {
    const bar = document.createElement("div");
    applyLayoutToBar(bar, layout("horizontal", "normal"));
    expect(bar.classList.contains("vertical")).toBe(false);
    expect(bar.classList.contains("size-xl")).toBe(false);
    expect(bar.style.flexDirection).toBe("row");
    expect(bar.style.height).toBe("100%");
  });

  it("vertical: column class AND inline flex-direction, auto height", () => {
    const bar = document.createElement("div");
    applyLayoutToBar(bar, layout("vertical", "normal"));
    expect(bar.classList.contains("vertical")).toBe(true);
    expect(bar.style.flexDirection).toBe("column");
    expect(bar.style.height).toBe("auto");
  });

  it("repeated toggles never leak stale classes", () => {
    const bar = document.createElement("div");
    applyLayoutToBar(bar, layout("vertical", "xl"));
    applyLayoutToBar(bar, layout("horizontal", "normal"));
    expect(bar.classList.contains("vertical")).toBe(false);
    expect(bar.classList.contains("size-xl")).toBe(false);
    expect(bar.style.flexDirection).toBe("row");
  });

  it("the reflow geometry for a live vertical toggle matches the applied DOM (both agree)", () => {
    // The reported bug: window sized for one layout, DOM stuck on the other.
    // Pin the invariant: same layout feeds BOTH sides.
    const bar = document.createElement("div");
    const next = layout("vertical", "normal");
    applyLayoutToBar(bar, next);
    const geometry = stripGeometry(next, 3);
    const inlineIsColumn = bar.style.flexDirection === "column";
    const narrowWindow = geometry.width < geometry.height;
    expect(inlineIsColumn).toBe(narrowWindow);
    expect(geometry).toEqual({ width: 156, height: 190 });
  });
});
