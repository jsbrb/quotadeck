// Chosen-provider tray badge resolution — pinned twin of the extension's
// resolveChosenBadge (background.ts, hito-12 WU-D2), mapped to tray bands
// instead of badge text: the icon carries the threshold band, the tooltip
// carries the figure.
//
// Ratified rules mirrored one-to-one: an UNshipped choice or an absent entry
// renders neutral; the chosen provider's error renders neutral with an ERR
// tooltip; a chosen qwen entry uses its quota percentage; anything else uses
// the zai 5h percentage (or the level fallback through formatBadgeText).
// The band comparisons are the SAME ones badgeBackgroundColor applies, so
// tray and badge can never drift.

import type { ProviderId } from "@shared/core/provider";
import { SHIPPED_PROVIDER_IDS } from "@shared/core/provider-metadata";
import {
  formatBadgeText,
  formatPercentageBadgeText,
} from "@shared/core/usage";
import type { ProviderSnapshotEntry } from "@shared/storage/snapshot-store";

export type TrayBand = "neutral" | "orange" | "deep" | "red";

export interface ChosenBand {
  readonly band: TrayBand;
  readonly tooltip: string;
}

const TOOLTIP_PREFIX = "QuotaDeck";

/** Pinned twin of badgeBackgroundColor's band comparisons (hito-10). */
function bandFor(percentage: number | undefined): TrayBand {
  if (percentage !== undefined && percentage >= 90) {
    return "red";
  }
  if (percentage !== undefined && percentage >= 80) {
    return "deep";
  }
  if (percentage !== undefined && percentage >= 50) {
    return "orange";
  }
  return "neutral";
}

export function resolveChosenBand(
  results: Partial<Record<ProviderId, ProviderSnapshotEntry>>,
  chosen: ProviderId,
  displayName: (id: ProviderId) => string = (id) => id,
): ChosenBand {
  const entry = SHIPPED_PROVIDER_IDS.includes(chosen) ? results[chosen] : undefined;
  if (entry === undefined) {
    return { band: "neutral", tooltip: TOOLTIP_PREFIX };
  }
  if (entry.status === "error") {
    return { band: "neutral", tooltip: `${TOOLTIP_PREFIX} — ERR` };
  }
  const usage = entry.usage;
  const qwenQuota = usage.providerId === "qwen" ? usage.quota?.percentage : undefined;
  const percentage = qwenQuota ?? usage.windows?.fiveHour?.percentage;
  const figureText =
    qwenQuota !== undefined
      ? formatPercentageBadgeText(qwenQuota)
      : formatBadgeText(usage);
  return {
    band: bandFor(percentage),
    tooltip: `${TOOLTIP_PREFIX} — ${displayName(chosen)} ${figureText}`,
  };
}
