// Normalized usage result + deterministic badge rendering (usage-badge spec §Badge Rendering).
//
// `formatBadgeText` is pure: identical input always produces identical text
// (spec: Deterministic text). Compact format (design):
// - value >= 1000        -> `1.2k`  (one decimal, trailing `.0` trimmed, currency symbol dropped)
// - 10 <= value < 1000   -> `¥12`   (currency symbol + integer)
// - 0 <= value < 10      -> `¥9.9`  (currency symbol + one decimal)
// - refresh failure      -> `ERR`   (ERROR_BADGE_TEXT; replaced by the next success)
import type { ProviderId } from './provider';

/** One OpenAI-style cost bucket: total spend for a (model, usage_type) pair. */
export interface LineItem {
  readonly model: string;
  readonly usageType: string;
  readonly value: number;
}

/** One monitor usage window (AD-26): API-provided passthrough, nothing derived here. */
export interface UsageWindow {
  /** API percentage, UNCAPPED (137 stays 137); absent when the API omits/nulls it. */
  readonly percentage?: number;
  /** round(total × percentage / 100); absent when percentage or total is. */
  readonly used?: number;
  /**
   * Window quota ceiling; OPTIONAL — a live-pinned TOKENS_LIMIT (plan pro,
   * 2026-09-05) carries percentage + nextResetTime with no total.
   */
  readonly total?: number;
  /** Reset instant (epoch ms, `nextResetTime` verbatim); absent when the API omits it. */
  readonly resetAt?: number;
}

/** Per-tool monthly MCP usage (AD-26). */
export interface McpToolUsage {
  readonly name: string;
  readonly used: number;
}

/** Monthly MCP window (AD-26): no percentage, no countdown — never synthesized. */
export interface McpWindow {
  readonly used: number;
  readonly ceiling: number;
  readonly tools: readonly McpToolUsage[];
}

/** ZAI monitor windows (AD-26): plan level, 5h/weekly token windows, monthly MCP. */
export interface MonitorWindows {
  /** Plan level (`data.level`); absent when the API omits it. */
  readonly level?: string;
  readonly fiveHour?: UsageWindow;
  readonly weekly?: UsageWindow;
  readonly mcp?: McpWindow;
}

/**
 * Qwen plan probe status (hito-8 §Qwen Plan Probe): the binary outcome of
 * the token-plan probe — available, exhausted (reset instant when the 429
 * text parses), or key-rejected. No percentage or total is ever synthesized:
 * no such figure exists on any key surface.
 */
export type PlanStatus = 'available' | 'exhausted' | 'key-rejected';

/** The plan probe result riding a qwen usage entry; optional like `windows`. */
export interface PlanInfo {
  readonly status: PlanStatus;
  /** Reset instant (epoch ms) parsed from the surfaced 429 text; optional. */
  readonly resetAt?: number;
}

/**
 * Qwen token-plan monthly quota window (hito-12 WU-C2; evidence
 * docs/spike/endpoints.md §Qwen token-plan quota — session-token surface).
 * `percentage` is the gateway's 0..1 USED fraction mapped to the 0-100
 * window convention — UNCAPPED passthrough (a server 1.5 stays 150), never
 * synthesized; `resetAt` is the epoch-ms reset instant carried VERBATIM.
 * Absent fields stay absent: no used/total exists on the surface and none is
 * derived here. `fetchedAt` is the mint+gateway hop's refresh instant.
 */
export interface TokenPlanQuota {
  readonly percentage?: number;
  readonly resetAt?: number;
  /** Refresh instant from the injected Clock (AD-1) — never Date.now() inline. */
  readonly fetchedAt: number;
}

/** The single result shape every provider folds into. */
export interface NormalizedUsage {
  readonly providerId: ProviderId;
  /** `balance` = remaining credit; `cost` = spend over the queried window. */
  readonly kind: 'balance' | 'cost';
  /**
   * Monetary figure (ZAI sum(costPrice / 1000 * deductUsage); Qwen
   * Data.AvailableAmount; Kimi data.available_balance; OpenAI
   * sum(results[].amount.value)) — optional since the ZAI monitor endpoint
   * reports no monetary value (AD-26).
   */
  readonly value?: number;
  /** ISO currency code from the response; optional alongside `value` (AD-26). */
  readonly currency?: string;
  /** ZAI only: tier label — the latest in-window `tokenResourceName` (AD-23). */
  readonly tier?: string;
  /** OpenAI only: per (model, usage_type) bucket totals. */
  readonly breakdown?: readonly LineItem[];
  /** ZAI monitor windows (AD-26); absent on non-ZAI results. */
  readonly windows?: MonitorWindows;
  /**
   * Qwen plan probe status (hito-8 §Qwen Plan Probe); optional like
   * `windows` — `formatBadgeText` ignores it (the badge renders the balance).
   */
  readonly plan?: PlanInfo;
  /**
   * Qwen token-plan quota window (hito-12 WU-C2); optional like `plan` —
   * `formatBadgeText` ignores it (quota badge rendering is a later unit).
   */
  readonly quota?: TokenPlanQuota;
  /** Epoch ms from the injected Clock (AD-1) — never Date.now() inline. */
  readonly fetchedAt: number;
}

/** Badge marker shown when a refresh failed; the next successful tick replaces it. */
export const ERROR_BADGE_TEXT = 'ERR';

/**
 * Badge background for a 5h-window percentage (hito-10 threshold alerting).
 * Pure and deterministic over the UNCAPPED input (137 stays red): the band
 * deepens as quota runs out — light neutral slate <50, orange ≥50, deep
 * orange ≥80, red ≥90. `undefined` (no percentage) renders neutral.
 */
export function badgeBackgroundColor(percentage: number | undefined): string {
  if (percentage !== undefined && percentage >= 90) {
    return '#DC2626';
  }
  if (percentage !== undefined && percentage >= 80) {
    return '#EA580C';
  }
  if (percentage !== undefined && percentage >= 50) {
    return '#F97316';
  }
  return '#E2E8F0';
}

/**
 * Badge text color paired with `badgeBackgroundColor` (hito-10): the two
 * functions mirror the SAME band comparisons. Below 50 — and for an absent
 * percentage — the badge sits on the light slate `#E2E8F0`, so text renders
 * near-black `#0F172A` for tiny-badge legibility; from 50 upward the bands
 * are saturated, so text renders white.
 */
export function badgeTextColor(percentage: number | undefined): string {
  if (percentage !== undefined && percentage >= 50) {
    return '#FFFFFF';
  }
  return '#0F172A';
}

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/** Symbol for an ISO currency code; `''` when unknown. Exported for popup display reuse (AD-11). */
export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? '';
}

/** `1.2k` style: divide by 1000, one decimal, trim a trailing `.0`. */
function compactThousands(magnitude: number): string {
  const scaled = (magnitude / 1000).toFixed(1);
  const trimmed = scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled;
  return `${trimmed}k`;
}

/**
 * Integer-display badge text for a percentage (hito-12 WU-D2): UNCAPPED
 * passthrough through the SAME rounding the ZAI 5h badge path has always
 * used — single-sourced so the qwen quota badge can never drift from it
 * (no rounding games, no new rules).
 */
export function formatPercentageBadgeText(percentage: number): string {
  return `${Math.round(percentage)}%`;
}

/**
 * Renders a NormalizedUsage (or `null` for a failed refresh) as badge text.
 * Pure and deterministic: the same input yields the same string on every call.
 *
 * Windows branch first (AD-26): a monitor result renders its 5h percentage
 * uncapped as integer display text; without a percentage it falls back to the
 * plan level, and with neither the honest badge is the empty string.
 */
export function formatBadgeText(usage: NormalizedUsage | null): string {
  if (usage === null) {
    return ERROR_BADGE_TEXT;
  }
  if (usage.windows !== undefined) {
    const percentage = usage.windows.fiveHour?.percentage;
    if (percentage !== undefined) {
      return formatPercentageBadgeText(percentage);
    }
    return usage.windows.level ?? '';
  }
  // Type guard (n3): value is optional now; a usage with neither windows nor
  // a monetary value renders the empty badge rather than `NaN`-style output.
  if (usage.value === undefined) {
    return '';
  }
  const symbol = currencySymbol(usage.currency ?? '');
  const magnitude = Math.abs(usage.value);
  const sign = usage.value < 0 ? '-' : '';
  if (magnitude >= 1000) {
    // Symbol dropped by design: four characters is the practical badge budget.
    return `${sign}${compactThousands(magnitude)}`;
  }
  if (magnitude >= 10) {
    return `${sign}${symbol}${Math.round(magnitude)}`;
  }
  return `${sign}${symbol}${magnitude.toFixed(1)}`;
}
