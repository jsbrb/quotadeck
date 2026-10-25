// Taskbar segment rendering (WU-G): the flyout IS a second taskbar strip.
// One minimalist segment per keyed provider — name, threshold-colored
// percentage, reset countdown. No cards, no chrome. The threshold colors
// reuse the extension's own band palette so desktop and extension never
// drift; band text colors are adapted for the dark strip.

import type { ProviderId } from "@shared/core/provider";
import { PROVIDER_METADATA } from "@shared/core/provider-metadata";
import type { NormalizedUsage } from "@shared/core/usage";
import type { CycleSnapshot, ProviderSnapshotEntry } from "@shared/storage/snapshot-store";

const ERROR_LABELS: Record<string, string> = {
  auth: "AUTH FAILED",
  "rate-limit": "RATE LIMITED",
  server: "SERVER ERROR",
  network: "NETWORK ERROR",
  unknown: "ERROR",
};

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
 * #1f1f1f: light slate <50, orange >=50, deep orange >=80, bright red >=90.
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

/** The segment percentage: zai 5h window, or the qwen token-plan quota. */
function segmentPercentage(usage: NormalizedUsage): number | undefined {
  if (usage.providerId === "qwen") {
    return usage.quota?.percentage ?? usage.windows?.fiveHour?.percentage;
  }
  return usage.windows?.fiveHour?.percentage;
}

/** Minimal countdown from `now` to an epoch-ms reset instant. */
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

function segmentReset(usage: NormalizedUsage, now: number): string {
  const resetAt = usage.quota?.resetAt ?? usage.windows?.fiveHour?.resetAt;
  const countdown = formatCountdown(now, resetAt);
  return countdown === "" ? "" : `RESETS ${countdown}`;
}

function okSegment(id: ProviderId, usage: NormalizedUsage, now: number): string {
  const percentage = segmentPercentage(usage);
  const text = percentage !== undefined ? `${Math.round(percentage)}%` : "";
  const color = pctColor(percentage);
  const reset = segmentReset(usage, now);
  return `
    <div class="seg">
      <div class="seg-top">
        <span class="seg-name">${escapeHtml(shortName(id))}</span>
        <span class="seg-pct" style="color:${color}">${escapeHtml(text)}</span>
      </div>
      <span class="seg-reset">${escapeHtml(reset)}</span>
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

/**
 * The full strip body (S8): ONLY keyed providers render, in stable metadata
 * order. Zero keys → one hint segment.
 */
export function renderSegments(snapshot: CycleSnapshot, now: number): string {
  const keyed = Object.keys(snapshot.results) as ProviderId[];
  const ordered = [
    ...(PROVIDER_METADATA.map((entry) => entry.id) as ProviderId[]),
    ...keyed,
  ].filter((id, index, all) => snapshot.results[id] !== undefined && all.indexOf(id) === index);

  if (ordered.length === 0) {
    return `
      <div class="seg">
        <div class="seg-top">
          <span class="seg-name">NO KEYS YET</span>
        </div>
        <span class="seg-reset">RIGHT-CLICK TRAY ICON → KEYS</span>
      </div>`;
  }
  const segments: string[] = [];
  for (const id of ordered) {
    const entry = snapshot.results[id];
    if (entry === undefined) {
      continue;
    }
    segments.push(entry.status === "ok" ? okSegment(id, entry.usage, now) : errorSegment(id, entry));
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

/** Number of cards the current snapshot renders (strip width driver). */
export function keyedCount(snapshot: CycleSnapshot): number {
  return Object.keys(snapshot.results).length;
}
