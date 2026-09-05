import { describe, expect, it } from 'vitest';
import {
  ERROR_BADGE_TEXT,
  formatBadgeText,
  type BudgetReport,
  type NormalizedUsage,
} from './usage';

function usage(overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return {
    providerId: 'zai',
    kind: 'balance',
    value: 12.34,
    currency: 'CNY',
    fetchedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('NormalizedUsage.budget (AD-22)', () => {
  const budget: BudgetReport = {
    used: 2400,
    limit: 2400,
    percent: 100,
    tier: 'Lite',
    resetAt: 1_788_080_400_000,
  };

  it('carries an optional budget report alongside the cost value', () => {
    const withBudget = usage({ budget });
    expect(withBudget.budget).toEqual(budget);
  });

  it('budget presence never changes badge rendering — the badge stays cost-based', () => {
    expect(formatBadgeText(usage({ value: 12.34, budget }))).toBe('¥12');
    expect(formatBadgeText(usage({ value: 12.34 }))).toBe(formatBadgeText(usage({ value: 12.34, budget })));
  });
});

describe('formatBadgeText', () => {
  it('renders symbol + integer at 10 and above', () => {
    expect(formatBadgeText(usage({ value: 12.34 }))).toBe('¥12');
    expect(formatBadgeText(usage({ value: 10 }))).toBe('¥10');
    expect(formatBadgeText(usage({ value: 456.7 }))).toBe('¥457');
  });

  it('renders one decimal below 10', () => {
    expect(formatBadgeText(usage({ value: 9.87 }))).toBe('¥9.9');
    expect(formatBadgeText(usage({ value: 0 }))).toBe('¥0.0');
    expect(formatBadgeText(usage({ value: 4 }))).toBe('¥4.0');
  });

  it('renders thousands compactly and drops the currency symbol', () => {
    expect(formatBadgeText(usage({ value: 1234 }))).toBe('1.2k');
    expect(formatBadgeText(usage({ value: 1000 }))).toBe('1k');
    expect(formatBadgeText(usage({ value: 1995 }))).toBe('2k');
    expect(formatBadgeText(usage({ value: 12345 }))).toBe('12.3k');
  });

  it('renders the error marker for a failed refresh', () => {
    expect(formatBadgeText(null)).toBe(ERROR_BADGE_TEXT);
    expect(ERROR_BADGE_TEXT).toBe('ERR');
  });

  it('uses the currency symbol of the result currency', () => {
    expect(formatBadgeText(usage({ value: 45.6, currency: 'USD' }))).toBe('$46');
    expect(formatBadgeText(usage({ value: 45.6, currency: 'EUR' }))).toBe('€46');
    // Unknown currency codes fall back to the bare number (still deterministic).
    expect(formatBadgeText(usage({ value: 45.6, currency: 'JPY' }))).toBe('46');
  });

  it('is deterministic: identical input yields identical text across calls', () => {
    const input = usage({ value: 9.87, currency: 'CNY' });
    const first = formatBadgeText(input);
    expect(formatBadgeText(input)).toBe(first);
    expect(formatBadgeText(usage({ value: 9.87, currency: 'CNY' }))).toBe(first);
  });
});
