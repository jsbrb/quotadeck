// Strip layout preferences (T18-T20) — desktop-only prefs stored in the
// non-secret area alongside the extension-parity keys:
// - qd:pref:strip-order: provider id order of the segments (partial allowed;
//   ids not listed render after the listed ones in metadata order).
// - qd:pref:strip-orientation: "horizontal" (default, taskbar-parallel) or
//   "vertical" (column glued to the right screen edge, growing up from the
//   taskbar).
// - qd:pref:strip-size: "normal" (taskbar height, 48px) or "xl" (double).

import type { ProviderId } from "@shared/core/provider";
import type { StorageArea } from "@shared/storage/key-store";

export const STRIP_ORDER_KEY = "qd:pref:strip-order";
export const STRIP_ORIENTATION_KEY = "qd:pref:strip-orientation";
export const STRIP_SIZE_KEY = "qd:pref:strip-size";

export type StripOrientation = "horizontal" | "vertical";
export type StripSize = "normal" | "xl";

export interface StripLayout {
  readonly order: readonly ProviderId[];
  readonly orientation: StripOrientation;
  readonly size: StripSize;
}

export const DEFAULT_LAYOUT: StripLayout = { order: [], orientation: "horizontal", size: "normal" };

export async function readStripLayout(prefs: StorageArea): Promise<StripLayout> {
  const items = await prefs.get([STRIP_ORDER_KEY, STRIP_ORIENTATION_KEY, STRIP_SIZE_KEY]);
  const orderRaw = items[STRIP_ORDER_KEY];
  return {
    order: Array.isArray(orderRaw)
      ? orderRaw.filter((value): value is ProviderId => typeof value === "string")
      : [],
    orientation: items[STRIP_ORIENTATION_KEY] === "vertical" ? "vertical" : "horizontal",
    size: items[STRIP_SIZE_KEY] === "xl" ? "xl" : "normal",
  };
}

export async function writeStripOrder(
  prefs: StorageArea,
  order: readonly ProviderId[],
): Promise<void> {
  await prefs.set({ [STRIP_ORDER_KEY]: [...order] });
}

export async function writeStripOrientation(
  prefs: StorageArea,
  orientation: StripOrientation,
): Promise<void> {
  await prefs.set({ [STRIP_ORIENTATION_KEY]: orientation });
}

export async function writeStripSize(prefs: StorageArea, size: StripSize): Promise<void> {
  await prefs.set({ [STRIP_SIZE_KEY]: size });
}

// --- Geometry (WU-N) -------------------------------------------------------
// SEG_SIZE + paddings are the SINGLE source of the strip window size and
// mirror the CSS custom properties on #bar (index.html). Kept as a pure
// function so the horizontal/vertical x normal/xl matrix is unit-tested.
export const SEG_SIZE: Record<StripSize, { readonly width: number; readonly height: number }> = {
  normal: { width: 180, height: 48 },
  xl: { width: 230, height: 68 },
};
export const STRIP_PAD_X = 16;
export const STRIP_PAD_Y = 16;
export const REFRESH_SEGMENT_WIDTH = 44;

export interface StripGeometry {
  readonly width: number;
  readonly height: number;
}

/**
 * Window size for `segmentCount` provider segments + the trailing refresh
 * segment. Horizontal: one row (refresh rides the width). Vertical: one
 * column (refresh rides below, as a full-width row of segment height).
 * An empty strip still renders one hint segment.
 */
export function stripGeometry(layout: StripLayout, segmentCount: number): StripGeometry {
  const count = Math.max(segmentCount, 1);
  const seg = SEG_SIZE[layout.size];
  if (layout.orientation === "vertical") {
    return {
      width: STRIP_PAD_X + seg.width,
      height: STRIP_PAD_Y + (count + 1) * seg.height,
    };
  }
  return {
    width: STRIP_PAD_X + count * seg.width + REFRESH_SEGMENT_WIDTH,
    height: seg.height,
  };
}
