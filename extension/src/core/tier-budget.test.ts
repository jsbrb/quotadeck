import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIER_LIMITS,
  billingMonthsFor,
  cstEpoch,
  cstParts,
  epochFromBillingNo,
  evaluateBudget,
} from './tier-budget';

// Tier-budget spec, scenario by scenario (7 requirements / 14 scenarios).
// Every instant is a literal epoch in the declared fixed +08:00 zone built via
// cstEpoch — no wall-clock reads, no local-timezone dependence.

const HOUR = 3_600_000;
const CUSTOMER_ID = '10997756';

/** The main-flow "now": 2026-08-30 12:00:00 +08:00, from an injectable clock. */
const NOW = cstEpoch(2026, 8, 30, 12, 0, 0);

describe('cstEpoch/cstParts — one declared zone, fixed +08:00 (spec §Timezone Discipline)', () => {
  it('cstEpoch maps a +08:00 wall time to the epoch 8 hours before the UTC instant', () => {
    expect(cstEpoch(2026, 9, 5, 12, 0, 0)).toBe(Date.UTC(2026, 8, 5, 4, 0, 0));
    expect(cstEpoch(2026, 1, 1, 0, 0, 0)).toBe(Date.UTC(2025, 11, 31, 16, 0, 0));
  });

  it('cstParts recovers the +08:00 calendar fields where the UTC calendar day differs', () => {
    // 03:00 +08:00 is still the previous UTC calendar day — a UTC formatter
    // would report the wrong day. cstParts must keep the +08:00 fields.
    const epoch = cstEpoch(2026, 9, 5, 3, 30, 5);
    expect(cstParts(epoch)).toEqual({ year: 2026, month: 9, day: 5, hour: 3, minute: 30, second: 5 });
  });
});

describe('Trailing-Window Usage Computation (spec §Trailing-Window Usage Computation)', () => {
  it('sums apiUsage for in-window records only — at or after now − 5h (§Window sum)', () => {
    const report = evaluateBudget(
      [
        { apiUsage: 900, epochMs: NOW - 4 * HOUR },
        { apiUsage: 600, epochMs: NOW - HOUR },
        { apiUsage: 999, epochMs: NOW - 6 * HOUR }, // before the window start
        { apiUsage: 111, epochMs: undefined }, // unextractable — excluded below
      ],
      { now: NOW, tierLimits: {} },
    );
    expect(report.used).toBe(1500);
  });

  it('extracts the 13 epoch-ms digits after the first customerId occurrence (§Epoch extraction from billingNo)', () => {
    const epoch = cstEpoch(2026, 8, 30, 8, 0, 0);
    expect(epochFromBillingNo(`BL${CUSTOMER_ID}${epoch}`, CUSTOMER_ID)).toBe(epoch);
    // Without a customerId to anchor on, the same billingNo yields nothing.
    expect(epochFromBillingNo(`BL${CUSTOMER_ID}${epoch}`, undefined)).toBeUndefined();
  });

  it('excludes records whose billingNo lacks the customerId, without error (§Unextractable record excluded)', () => {
    expect(epochFromBillingNo('BL202608010001', CUSTOMER_ID)).toBeUndefined();
    expect(epochFromBillingNo(`BL${CUSTOMER_ID}17880480000`, CUSTOMER_ID)).toBeUndefined(); // only 12 digits follow
    const report = evaluateBudget(
      [
        { apiUsage: 900, epochMs: NOW - HOUR },
        { apiUsage: 777, epochMs: epochFromBillingNo('BL202608010001', CUSTOMER_ID) },
      ],
      { now: NOW, tierLimits: {} },
    );
    expect(report.used).toBe(900); // the unextractable record never enters the window
  });
});

describe('Tier Derivation (spec §Tier Derivation)', () => {
  it('derives the tier from the in-window record with maximum transaction_time (§Latest record wins)', () => {
    const report = evaluateBudget(
      [
        { apiUsage: 10_000, epochMs: NOW - 4 * HOUR, tokenResourceName: 'Pro' },
        { apiUsage: 20_000, epochMs: NOW - HOUR, tokenResourceName: 'Lite' },
      ],
      { now: NOW, tierLimits: {} },
    );
    expect(report.tier).toBe('Lite');
  });
});

describe('Configurable Tier Limits (spec §Configurable Tier Limits)', () => {
  it('applies the default limits when none are configured (§Default limits)', () => {
    expect(DEFAULT_TIER_LIMITS).toEqual({ Lite: 2400, Pro: 12_000, Max: 48_000 });
    const report = evaluateBudget(
      [{ apiUsage: 1200, epochMs: NOW - HOUR, tokenResourceName: 'Pro' }],
      { now: NOW, tierLimits: {} },
    );
    expect(report.limit).toBe(12_000);
  });

  it('uses an overridden limit over the default (§Overridden limit)', () => {
    const report = evaluateBudget(
      [{ apiUsage: 50, epochMs: NOW - HOUR, tokenResourceName: 'Lite' }],
      { now: NOW, tierLimits: { Lite: 100 } },
    );
    expect(report.limit).toBe(100);
    expect(report.percent).toBe(50);
  });

  it('reports usage without a percentage for a tier without a limit (§Unknown tier)', () => {
    const report = evaluateBudget(
      [{ apiUsage: 700, epochMs: NOW - HOUR, tokenResourceName: 'Team' }],
      { now: NOW, tierLimits: {} },
    );
    expect(report.used).toBe(700);
    expect(report.tier).toBe('Team');
    expect(report.limit).toBeUndefined();
    expect(report.percent).toBeUndefined();
  });
});

describe('Percentage Computation (spec §Percentage Computation)', () => {
  it('rounds used/limit × 100 (§Rounding)', () => {
    const report = evaluateBudget(
      [{ apiUsage: 100, epochMs: NOW - HOUR, tokenResourceName: 'Pro' }],
      { now: NOW, tierLimits: { Pro: 300 } },
    );
    expect(report.percent).toBe(33);
  });

  it('caps the percentage at 100 (§Cap at 100)', () => {
    const report = evaluateBudget(
      [{ apiUsage: 30_000, epochMs: NOW - HOUR, tokenResourceName: 'Pro' }],
      { now: NOW, tierLimits: {} },
    );
    expect(report.percent).toBe(100);
  });
});

describe('Reset Countdown (spec §Reset Countdown)', () => {
  it('derives resetAt from the latest in-window record timeWindow end (§Countdown derived)', () => {
    const resetAt = NOW + 2 * HOUR;
    const report = evaluateBudget(
      [
        { apiUsage: 10, epochMs: NOW - 4 * HOUR, tokenResourceName: 'Pro', timeWindowEnd: NOW + HOUR },
        { apiUsage: 20, epochMs: NOW - HOUR, tokenResourceName: 'Lite', timeWindowEnd: resetAt },
      ],
      { now: NOW, tierLimits: {} },
    );
    expect(report.resetAt).toBe(resetAt);
  });

  it('reports usage, tier and percentage with the countdown absent when the latest record has no timeWindow (§Graceful absence)', () => {
    const report = evaluateBudget(
      [
        { apiUsage: 10, epochMs: NOW - 4 * HOUR, tokenResourceName: 'Pro', timeWindowEnd: NOW + HOUR },
        { apiUsage: 20, epochMs: NOW - HOUR, tokenResourceName: 'Lite' }, // latest record, no timeWindowEnd
      ],
      { now: NOW, tierLimits: {} },
    );
    expect(report.used).toBe(30);
    expect(report.tier).toBe('Lite');
    expect(report.percent).toBe(1); // 30/2400 → 1.25 rounds to 1
    expect(report.resetAt).toBeUndefined();
  });
});

describe('Month-Straddle Fetching (spec §Month-Straddle Fetching)', () => {
  it('returns both billingMonths when now − 5h falls in the previous month, oldest first (§Straddle)', () => {
    // 02:00 +08:00 on Aug 1 → the window starts 21:00 Jul 31.
    expect(billingMonthsFor(cstEpoch(2026, 8, 1, 2, 0, 0))).toEqual(['2026-07', '2026-08']);
    // The straddle rolls across the year boundary too.
    expect(billingMonthsFor(cstEpoch(2027, 1, 1, 2, 0, 0))).toEqual(['2026-12', '2027-01']);
  });

  it('returns only the current month once the window start is inside it (§No straddle)', () => {
    expect(billingMonthsFor(cstEpoch(2026, 8, 15, 12, 0, 0))).toEqual(['2026-08']);
    // Boundary: window start exactly at the month midnight → current month only.
    expect(billingMonthsFor(cstEpoch(2026, 8, 1, 5, 0, 0))).toEqual(['2026-08']);
    // One second earlier the window still touches July.
    expect(billingMonthsFor(cstEpoch(2026, 8, 1, 4, 59, 59))).toEqual(['2026-07', '2026-08']);
  });
});

describe('Timezone Discipline (spec §Timezone Discipline)', () => {
  it('decides window membership by epoch order where date strings disagree (§Epoch ordering decides membership)', () => {
    // 21:00 and 19:00 on Aug 30 (+08:00) share the Aug 30 UTC calendar day —
    // any same-day string heuristic collapses them; epoch order does not.
    const now = cstEpoch(2026, 8, 31, 1, 0, 0); // window starts 20:00 Aug 30 +08:00
    const inWindow = cstEpoch(2026, 8, 30, 21, 0, 0);
    const beforeWindow = cstEpoch(2026, 8, 30, 19, 0, 0);
    const report = evaluateBudget(
      [
        { apiUsage: 900, epochMs: inWindow, tokenResourceName: 'Pro' },
        { apiUsage: 999, epochMs: beforeWindow, tokenResourceName: 'Max' },
      ],
      { now, tierLimits: {} },
    );
    expect(report.used).toBe(900);
    expect(report.tier).toBe('Pro');
  });
});
