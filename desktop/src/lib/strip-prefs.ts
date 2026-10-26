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
