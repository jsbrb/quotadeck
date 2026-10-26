// Taskbar segment rendering (WU-G/WU-L): the flyout IS a second taskbar strip.
// One equal-sized minimalist segment per configured provider — name +
// threshold-colored percentage on top, context below (ZAI/Qwen: reset
// countdown; DeepSeek wallet: money left of total). The threshold colors
// reuse the extension's own band palette so desktop and extension never
// drift; band text colors are adapted for the dark strip.

import type { ProviderId } from "@shared/core/provider";
import { PROVIDER_METADATA } from "@shared/core/provider-metadata";
import {
  currencySymbol,
  type NormalizedUsage,
} from "@shared/core/usage";
import type { CycleSnapshot, ProviderSnapshotEntry } from "@shared/storage/snapshot-store";

const ERROR_LABELS: Record<string, string> = {
  auth: "AUTH FAILED",
  "rate-limit": "RATE LIMITED",
  server: "SERVER ERROR",
  network: "NETWORK ERROR",
  unknown: "ERROR",
};

/** Structural view of the DeepSeek wallet field (hito-13; absent pre-merge). */
interface WalletShape {
  readonly currency?: string;
  readonly total?: number;
  readonly consumed?: number;
  readonly percentage?: number;
}

function walletOf(usage: NormalizedUsage): WalletShape | undefined {
  return (usage as { wallet?: WalletShape }).wallet;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Short segment label: the display name's first word ("ZAI", "Qwen", …). */
export function shortName(id: ProviderId): string {
  const full = PROVIDER_METADATA.find((entry) => entry.id === id)?.displayName ?? id;
  return full.split(" ")[0] ?? full;
}

/**
 * Threshold band text color on the dark strip — the SAME band comparisons as
 * the extension's badgeBackgroundColor (hito-10), mapped to legible hues on
 * #1f1f1f.
 */
function pctColor(percentage: number | undefined): string {
  if (percentage !== undefined && percentage >= 90) {
    return "#ef4444";
  }
  if (percentage !== undefined && percentage >= 80) {
    return "#ea580c";
  }
  if (percentage !== undefined && percentage >= 50) {
    return "#f97316";
  }
  return "#e2e8f0";
}

/**
 * The segment percentage: qwen prefers its token-plan quota; wallet providers
 * (DeepSeek) use the consumed-share percentage; otherwise the zai 5h window.
 */
function segmentPercentage(usage: NormalizedUsage): number | undefined {
  if (usage.providerId === "qwen") {
    return usage.quota?.percentage ?? usage.windows?.fiveHour?.percentage;
  }
  const wallet = walletOf(usage);
  if (wallet?.percentage !== undefined) {
    return wallet.percentage;
  }
  return usage.windows?.fiveHour?.percentage;
}

/** `5m`/`2h 8m`/`1d 2h` countdown from `now` to an epoch-ms reset instant. */
export function formatCountdown(now: number, resetAt: number | undefined): string {
  if (resetAt === undefined) {
    return "";
  }
  const diff = resetAt - now;
  if (diff <= 0) {
    return "NOW";
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "<1m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Bottom line: money-left/total for wallet usage, else the reset countdown. */
function segmentBottom(usage: NormalizedUsage, now: number): string {
  const wallet = walletOf(usage);
  if (wallet?.total !== undefined && usage.value !== undefined) {
    const symbol = currencySymbol(wallet.currency ?? usage.currency ?? "");
    return `${symbol}${usage.value.toFixed(2)} / ${symbol}${wallet.total.toFixed(2)} LEFT`;
  }
  const resetAt = usage.quota?.resetAt ?? usage.windows?.fiveHour?.resetAt;
  const countdown = formatCountdown(now, resetAt);
  return countdown === "" ? "" : `RESETS ${countdown}`;
}

/** Percentage display text: number, space, sign — never overlapping. */
export function formatSegmentPercentage(percentage: number): string {
  return `${Math.round(percentage)} %`;
}

function okSegment(id: ProviderId, usage: NormalizedUsage, now: number): string {
  const percentage = segmentPercentage(usage);
  const text = percentage !== undefined ? formatSegmentPercentage(percentage) : "";
  const color = pctColor(percentage);
  const bottom = segmentBottom(usage, now);
  return `
    <div class="seg">
      <div class="seg-top">
        <span class="seg-name">${escapeHtml(shortName(id))}</span>
        <span class="seg-pct" style="color:${color}">${escapeHtml(text)}</span>
      </div>
      <span class="seg-reset">${escapeHtml(bottom)}</span>
    </div>`;
}

function errorSegment(id: ProviderId, entry: Extract<ProviderSnapshotEntry, { status: "error" }>): string {
  const label = ERROR_LABELS[entry.errorClass] ?? "ERROR";
  return `
    <div class="seg">
      <div class="seg-top">
        <span class="seg-name">${escapeHtml(shortName(id))}</span>
      </div>
      <span class="seg-err">${escapeHtml(label)}</span>
    </div>`;
}

function mutedSegment(id: ProviderId, hint?: string): string {
  return `
    <div class="seg">
      <div class="seg-top">
        <span class="seg-name">${escapeHtml(shortName(id))}</span>
      </div>
      <span class="seg-reset">${escapeHtml(hint ?? "NO DATA THIS TICK")}</span>
    </div>`;
}

/** Visible segment ids: results ∪ stored, honoring the stored order first,
 * then metadata order, then any unknown-but-visible ids. */
export function orderedSegments(
  snapshot: CycleSnapshot,
  storedProviders: readonly ProviderId[],
  order: readonly ProviderId[],
): ProviderId[] {
  const visible = new Set<ProviderId>([
    ...(Object.keys(snapshot.results) as ProviderId[]),
    ...storedProviders,
  ]);
  const listed = order.filter((id) => visible.has(id));
  const metadataOrder = PROVIDER_METADATA.map((entry) => entry.id) as ProviderId[];
  const rest = metadataOrder.filter((id) => visible.has(id) && !listed.includes(id));
  const unknown = [...visible].filter(
    (id) => !listed.includes(id) && !rest.includes(id),
  );
  return [...listed, ...rest, ...unknown];
}

/**
 * The full strip body (S8): every provider with a stored key renders, in the
 * configured order (T18). A provider whose tick produced no entry shows a
 * muted segment instead of vanishing; `hints` overrides the muted line (e.g.
 * "SIGN IN VIA TRAY" for a qwen session that was never started).
 */
export function renderSegments(
  snapshot: CycleSnapshot,
  now: number,
  storedProviders: readonly ProviderId[] = [],
  order: readonly ProviderId[] = [],
  hints: Partial<Record<ProviderId, string>> = {},
): string {
  const ids = orderedSegments(snapshot, storedProviders, order);

  if (ids.length === 0) {
    return `
      <div class="seg">
        <div class="seg-top">
          <span class="seg-name">NO KEYS YET</span>
        </div>
        <span class="seg-reset">RIGHT-CLICK TRAY ICON → KEYS</span>
      </div>`;
  }
  const segments: string[] = [];
  for (const id of ids) {
    const entry = snapshot.results[id];
    if (entry === undefined) {
      segments.push(mutedSegment(id, hints[id]));
    } else if (entry.status === "ok") {
      segments.push(okSegment(id, entry.usage, now));
    } else {
      segments.push(errorSegment(id, entry));
    }
  }
  return segments.join("\n");
}

/** Whole-tick failure notice: one red segment with the bounded message. */
export function renderTickNotice(message: string): string {
  return `
    <div class="seg">
      <div class="seg-top">
        <span class="seg-name">TICK FAILED</span>
      </div>
      <span class="seg-err">${escapeHtml(message.slice(0, 90))}</span>
    </div>`;
}

/** Number of visible segments (strip width driver). */
export function visibleCount(
  snapshot: CycleSnapshot,
  storedProviders: readonly ProviderId[] = [],
): number {
  return new Set([...(Object.keys(snapshot.results) as ProviderId[]), ...storedProviders]).size;
}
