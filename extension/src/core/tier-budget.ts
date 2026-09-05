// Pure tier-budget computation for ZAI window semantics (tier-budget spec;
// AD-20). Zero I/O: the clock, the records and the limit overrides are all
// injected, so every decision here is deterministic and epoch-based.
//
// Timezone discipline (spec §Timezone Discipline): all internal arithmetic is
// epoch milliseconds. The single declared zone is the fixed +08:00 offset
// (Asia/Shanghai — ZAI's platform zone, no DST): cstEpoch/cstParts convert
// between +08:00 calendar fields and epoch ms by pure arithmetic, and no
// window, month-boundary or countdown decision ever compares date strings.
import type { BudgetReport } from './usage';

/** Trailing window length the budget evaluates (spec: now − 5h). */
const WINDOW_MS = 5 * 3_600_000;

/** Fixed +08:00 offset (Asia/Shanghai, no DST) as epoch ms. */
const CST_OFFSET_MS = 8 * 3_600_000;

/** Default tier limits per 5-hour window (spec §Configurable Tier Limits). */
export const DEFAULT_TIER_LIMITS: Readonly<Record<string, number>> = {
  Lite: 2400,
  Pro: 12_000,
  Max: 48_000,
};

/** One provider-record extract the budget consumes (AD-20). */
export interface BudgetRecord {
  readonly apiUsage: number;
  /** transaction_time from billingNo; `undefined` = unextractable → excluded. */
  readonly epochMs: number | undefined;
  readonly tokenResourceName?: string;
  readonly timeWindowEnd?: number;
}

/** Epoch ms of a +08:00 wall-clock time: the UTC instant shifted back 8 hours. */
export function cstEpoch(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) - CST_OFFSET_MS;
}

/** +08:00 calendar fields for an epoch-ms instant (inverse of cstEpoch). */
export function cstParts(epochMs: number): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
} {
  const shifted = new Date(epochMs + CST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/**
 * transaction_time from a billingNo: the 13 epoch-ms digits immediately after
 * the FIRST customerId occurrence (spec §Epoch extraction from billingNo).
 * Anything else — missing customerId, customerId not found, fewer than 13
 * remaining characters, non-digit characters — yields `undefined`, and the
 * record is excluded deterministically (never an error).
 */
export function epochFromBillingNo(billingNo: string, customerId: string | undefined): number | undefined {
  if (customerId === undefined || customerId.length === 0) {
    return undefined;
  }
  const anchor = billingNo.indexOf(customerId);
  if (anchor === -1) {
    return undefined;
  }
  const digits = billingNo.slice(anchor + customerId.length, anchor + customerId.length + 13);
  if (!/^\d{13}$/.test(digits)) {
    return undefined;
  }
  const epochMs = Number(digits);
  return Number.isSafeInteger(epochMs) ? epochMs : undefined;
}

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Billing months a fetch must cover (spec §Month-Straddle Fetching): the
 * current +08:00 month, plus the previous one when the window start
 * (now − 5h) falls inside it. Oldest first.
 */
export function billingMonthsFor(now: number): readonly string[] {
  const current = cstParts(now);
  const windowStart = cstParts(now - WINDOW_MS);
  const label = monthLabel(current.year, current.month);
  if (windowStart.year === current.year && windowStart.month === current.month) {
    return [label];
  }
  // A 5-hour window can straddle at most one month boundary, so the previous
  // calendar month relative to `current` is the only other candidate.
  const [year, month] = current.month === 1 ? [current.year - 1, 12] : [current.year, current.month - 1];
  return [monthLabel(year, month), label];
}

/**
 * Folds record extracts into the budget report (spec): trailing-5h apiUsage
 * sum, tier from the latest in-window record, limit from the overrides merged
 * over the defaults, `percent = min(round(used / limit × 100), 100)`, and
 * `resetAt` from the latest in-window record's timeWindow end. Every field
 * that cannot be derived is absent (`undefined`), never an error.
 */
export function evaluateBudget(
  records: readonly BudgetRecord[],
  opts: { now: number; tierLimits: Readonly<Record<string, number>> },
): BudgetReport {
  const windowStart = opts.now - WINDOW_MS;
  const inWindow = records.filter(
    (record): record is BudgetRecord & { readonly epochMs: number } =>
      record.epochMs !== undefined && record.epochMs >= windowStart,
  );

  let used = 0;
  let latest: (BudgetRecord & { readonly epochMs: number }) | undefined;
  for (const record of inWindow) {
    used += record.apiUsage;
    if (latest === undefined || record.epochMs >= latest.epochMs) {
      latest = record; // >= keeps the later record on equal timestamps (deterministic)
    }
  }

  const tier =
    latest?.tokenResourceName !== undefined && latest.tokenResourceName.length > 0
      ? latest.tokenResourceName
      : undefined;
  const limit = tier !== undefined ? { ...DEFAULT_TIER_LIMITS, ...opts.tierLimits }[tier] : undefined;
  const percent = limit !== undefined ? Math.min(Math.round((used / limit) * 100), 100) : undefined;

  return { used, limit, percent, tier, resetAt: latest?.timeWindowEnd };
}
