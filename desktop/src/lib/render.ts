// Snapshot → flyout HTML. Compact desktop rendering of the same data the
// extension popup shows (Neo-Brutalist Developer Instrument palette); the
// threshold band colors reuse the extension's own badgeBackgroundColor /
// badgeTextColor so desktop and extension can never drift.

import type { ProviderId } from "@shared/core/provider";
import { PROVIDER_METADATA } from "@shared/core/provider-metadata";
import {
  badgeBackgroundColor,
  badgeTextColor,
  currencySymbol,
  type NormalizedUsage,
} from "@shared/core/usage";
import type { CycleSnapshot, ProviderSnapshotEntry } from "@shared/storage/snapshot-store";

const ERROR_LABELS: Record<string, string> = {
  auth: "Auth failed",
  "rate-limit": "Rate limited",
  server: "Server error",
  network: "Network error",
  unknown: "Error",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Display name for a provider id, shared by the cards and the tray tooltip. */
export function displayName(id: ProviderId): string {
  return PROVIDER_METADATA.find((entry) => entry.id === id)?.displayName ?? id;
}

/** `5m`/`2h`/`3d` age label for the LAST KNOWN chip. */
function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) {
    return `${Math.max(minutes, 0)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

/** The card's hero figure for an ok entry (same resolution order as the badge). */
function hero(usage: NormalizedUsage): { readonly text: string; readonly percentage?: number } {
  if (usage.windows !== undefined) {
    const percentage = usage.windows.fiveHour?.percentage;
    if (percentage !== undefined) {
      return { text: `${Math.round(percentage)}%`, percentage };
    }
    if (usage.windows.level !== undefined) {
      return { text: usage.windows.level };
    }
  }
  if (usage.quota?.percentage !== undefined) {
    return { text: `${Math.round(usage.quota.percentage)}%`, percentage: usage.quota.percentage };
  }
  if (usage.value !== undefined) {
    const symbol = currencySymbol(usage.currency ?? "");
    return { text: `${symbol}${usage.value.toFixed(2)}` };
  }
  return { text: "—" };
}

function windowLine(label: string, usage: NormalizedUsage, window: "fiveHour" | "weekly"): string {
  const win = usage.windows?.[window];
  if (win === undefined) {
    return "";
  }
  const parts = [label];
  if (win.percentage !== undefined) {
    parts.push(`${Math.round(win.percentage)}%`);
  }
  if (win.used !== undefined && win.total !== undefined) {
    parts.push(`${win.used.toLocaleString("en-US")} / ${win.total.toLocaleString("en-US")}`);
  }
  return `<p class="row">${escapeHtml(parts.join(" · "))}</p>`;
}

function okCard(id: ProviderId, usage: NormalizedUsage): string {
  const figure = hero(usage);
  const background = badgeBackgroundColor(figure.percentage);
  const color = badgeTextColor(figure.percentage);
  const extra =
    usage.plan !== undefined
      ? `<p class="row">PLAN · ${escapeHtml(usage.plan.status.toUpperCase())}${
          usage.plan.resetAt !== undefined
            ? ` · RESETS ${new Date(usage.plan.resetAt).toISOString().slice(11, 16)}Z`
            : ""
        }</p>`
      : "";
  return `
    <section class="card">
      <h2 class="provider-name">${escapeHtml(displayName(id))}</h2>
      <p class="hero" style="background:${background};color:${color}">${escapeHtml(figure.text)}</p>
      ${windowLine("5H", usage, "fiveHour")}
      ${windowLine("WEEKLY", usage, "weekly")}
      ${extra}
    </section>`;
}

function errorCard(id: ProviderId, entry: Extract<ProviderSnapshotEntry, { status: "error" }>, lastKnownAt: number | undefined, now: number): string {
  const label = ERROR_LABELS[entry.errorClass] ?? "Error";
  const lastKnown =
    lastKnownAt !== undefined
      ? `<span class="chip">LAST KNOWN T-${formatAge(now - lastKnownAt)}</span>`
      : "";
  return `
    <section class="card card-error">
      <h2 class="provider-name">${escapeHtml(displayName(id))}</h2>
      <p class="error-label">${escapeHtml(label)}</p>
      ${lastKnown}
    </section>`;
}

/**
 * Full flyout body for a cycle snapshot (S8): ONLY providers with a stored
 * key render — the tick persists one entry per keyed provider, so keyless
 * providers simply have no card. Cards follow the stable registry/metadata
 * order; unknown-but-keyed ids (future providers) append after. With zero
 * keys the honest strip is one small hint card.
 */
export function renderSnapshot(snapshot: CycleSnapshot, now: number): string {
  const keyed = Object.keys(snapshot.results) as ProviderId[];
  const ordered = [
    ...(PROVIDER_METADATA.map((entry) => entry.id) as ProviderId[]),
    ...keyed,
  ].filter((id, index, all) => snapshot.results[id] !== undefined && all.indexOf(id) === index);

  if (ordered.length === 0) {
    return '<section class="placeholder">NO KEYS YET — ADD ONE IN THE KEYS TAB</section>';
  }
  const cards: string[] = [];
  for (const id of ordered) {
    const entry = snapshot.results[id];
    if (entry === undefined) {
      continue;
    }
    if (entry.status === "ok") {
      cards.push(okCard(id, entry.usage));
    } else {
      const lastKnownAt = snapshot.lastKnown?.[id]?.usage.fetchedAt;
      cards.push(errorCard(id, entry, lastKnownAt, now));
    }
  }
  return cards.join("\n");
}

/** Number of cards the current snapshot renders (strip width driver). */
export function keyedCount(snapshot: CycleSnapshot): number {
  return Object.keys(snapshot.results).length;
}

/** Full-body error state (the tick itself failed, e.g. storage unavailable). */
export function renderTickError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<section class="card card-error"><p class="error-label">TICK FAILED</p><p class="row">${escapeHtml(message)}</p></section>`;
}
