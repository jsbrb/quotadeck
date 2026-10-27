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

// --- Geometry (WU-N/WU-Q/WU-R) ---------------------------------------------
// Widths are ORIENTATION-SPECIFIC per user feedback: the vertical column is
// visibly narrower (140/190) than the horizontal row (160/210) — same font
// sizes everywhere; only air varies. Heights stay uniform (48/68). These
// mirror the CSS custom properties on #bar (index.html).
export const SEG_SIZE: Record<StripSize, { readonly width: number; readonly height: number }> = {
  normal: { width: 160, height: 48 },
  xl: { width: 210, height: 68 },
};
export const VERTICAL_SEG_WIDTH: Record<StripSize, number> = { normal: 140, xl: 190 };
export const STRIP_PAD_X = 16;
export const STRIP_PAD_Y = 16;
export const REFRESH_SEGMENT_WIDTH = 44;
// Vertical refresh strip: a thin 30px band, not a full segment (S12 feedback).
export const REFRESH_STRIP_HEIGHT = 30;

export interface StripGeometry {
  readonly width: number;
  readonly height: number;
}

/**
 * Window size for `segmentCount` provider segments + the trailing refresh
 * strip. Horizontal: one row (refresh rides the width, 44px). Vertical: one
 * narrow column (refresh rides below as a thin 30px band). An empty strip
 * still renders one hint segment.
 */
export function stripGeometry(layout: StripLayout, segmentCount: number): StripGeometry {
  const count = Math.max(segmentCount, 1);
  const height = layout.size === "xl" ? 68 : 48;
  if (layout.orientation === "vertical") {
    return {
      width: STRIP_PAD_X + VERTICAL_SEG_WIDTH[layout.size],
      height: STRIP_PAD_Y + count * height + REFRESH_STRIP_HEIGHT,
    };
  }
  return {
    width: STRIP_PAD_X + count * SEG_SIZE[layout.size].width + REFRESH_SEGMENT_WIDTH,
    height,
  };
}
