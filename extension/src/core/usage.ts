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

/**
 * ZAI window-budget report (AD-20/22): trailing-5h usage vs the tier limit.
 * Every field that cannot be derived is absent (`undefined`), never an error.
 */
export interface BudgetReport {
  /** Σ apiUsage over records inside the trailing 5h window. */
  readonly used: number;
  /** Effective limit for the derived tier; absent when the tier has none. */
  readonly limit: number | undefined;
  /** min(round(used / limit × 100), 100); absent when the limit is. */
  readonly percent: number | undefined;
  /** tokenResourceName of the latest in-window record. */
  readonly tier: string | undefined;
  /** Latest in-window record's timeWindow end (epoch ms); absent when unparseable. */
  readonly resetAt: number | undefined;
}

/** One monitor usage window (AD-26): API-provided passthrough, nothing derived here. */
export interface UsageWindow {
  /** API percentage, UNCAPPED (137 stays 137); absent when the API omits/nulls it. */
  readonly percentage?: number;
  /** round(total × percentage / 100); absent when percentage or total is. */
  readonly used?: number;
  /** Window quota ceiling. */
  readonly total: number;
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
  /** ZAI only: trailing-5h tier budget (AD-22); absent on non-ZAI results. */
  readonly budget?: BudgetReport;
  /** ZAI monitor windows (AD-26); absent on non-ZAI results. */
  readonly windows?: MonitorWindows;
  /** Epoch ms from the injected Clock (AD-1) — never Date.now() inline. */
  readonly fetchedAt: number;
}

/** Badge marker shown when a refresh failed; the next successful tick replaces it. */
export const ERROR_BADGE_TEXT = 'ERR';

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
      return `${Math.round(percentage)}%`;
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
