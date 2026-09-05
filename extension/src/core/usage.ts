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

/** The single result shape every provider folds into. */
export interface NormalizedUsage {
  readonly providerId: ProviderId;
  /** `balance` = remaining credit; `cost` = spend over the queried window. */
  readonly kind: 'balance' | 'cost';
  /** ZAI: sum(costPrice / 1000 * deductUsage); Qwen: Data.AvailableAmount; Kimi: data.available_balance; OpenAI: sum(results[].amount.value). */
  readonly value: number;
  /** ISO currency code from the response (Qwen `Data.Currency`, Kimi `CNY`, OpenAI `amount.currency`, ZAI `CNY`). */
  readonly currency: string;
  /** ZAI only: tier label from `tokenResourceName`. */
  readonly tier?: string;
  /** OpenAI only: per (model, usage_type) bucket totals. */
  readonly breakdown?: readonly LineItem[];
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

function currencySymbol(currency: string): string {
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
 */
export function formatBadgeText(usage: NormalizedUsage | null): string {
  if (usage === null) {
    return ERROR_BADGE_TEXT;
  }
  const symbol = currencySymbol(usage.currency);
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
