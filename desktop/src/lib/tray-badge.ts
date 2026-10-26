// Tray badge resolution (WU-O): the icon's band reflects the MOST URGENT
// keyed provider (highest consumption percentage — the one that can hurt
// first) and the tooltip lists every provider's figure, so hovering answers
// "how am I doing overall" instead of one hardcoded provider. Band
// comparisons mirror badgeBackgroundColor (hito-10) — desktop and extension
// can never drift.

import type { ProviderId } from "@shared/core/provider";
import { SHIPPED_PROVIDER_IDS } from "@shared/core/provider-metadata";
import type { NormalizedUsage } from "@shared/core/usage";
import type { CycleSnapshot, ProviderSnapshotEntry } from "@shared/storage/snapshot-store";

export type TrayBand = "neutral" | "orange" | "deep" | "red";

export interface StripBadge {
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

/** The headline percentage a provider's entry contributes to the band. */
function urgentPercentage(usage: NormalizedUsage): number | undefined {
  if (usage.providerId === "qwen") {
    return usage.quota?.percentage;
  }
  if (usage.wallet?.percentage !== undefined) {
    return usage.wallet.percentage;
  }
  return usage.windows?.fiveHour?.percentage;
}

function figureText(
  entry: ProviderSnapshotEntry,
  displayName: (id: ProviderId) => string,
  id: ProviderId,
): string {
  if (entry.status === "error") {
    return `${displayName(id)} ERR`;
  }
  const pct = urgentPercentage(entry.usage);
  return pct === undefined ? displayName(id) : `${displayName(id)} ${Math.round(pct)} %`;
}

/**
 * Build the strip badge from the last cycle: one tooltip segment per shipped
 * provider present in the snapshot, band from the highest percentage seen.
 */
export function resolveStripBadge(
  results: Partial<Record<ProviderId, ProviderSnapshotEntry>>,
  displayName: (id: ProviderId) => string,
): StripBadge {
  const parts: string[] = [];
  let worst: number | undefined;
  for (const id of SHIPPED_PROVIDER_IDS) {
    const entry = results[id];
    if (entry === undefined) {
      continue;
    }
    parts.push(figureText(entry, displayName, id));
    if (entry.status === "ok") {
      const pct = urgentPercentage(entry.usage);
      if (pct !== undefined && (worst === undefined || pct > worst)) {
        worst = pct;
      }
    }
  }
  return {
    band: bandFor(worst),
    tooltip: parts.length > 0 ? `${TOOLTIP_PREFIX} — ${parts.join(" · ")}` : TOOLTIP_PREFIX,
  };
}
