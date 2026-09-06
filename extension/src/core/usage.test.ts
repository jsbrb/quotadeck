import { describe, expect, it } from 'vitest';
import {
  ERROR_BADGE_TEXT,
  formatBadgeText,
  type MonitorWindows,
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

describe('NormalizedUsage.windows (AD-26) — MonitorWindows model', () => {
  const windows: MonitorWindows = {
    level: 'Pro',
    fiveHour: { percentage: 137, used: 16_440, total: 12_000, resetAt: 1_788_080_400_000 },
    weekly: { percentage: 42, used: 5_040, total: 12_000 },
    mcp: { used: 3, ceiling: 60, tools: [{ name: 'web-search', used: 2 }, { name: 'code-execution', used: 1 }] },
  };

  it('carries windows alongside the result; value/currency may be absent on monitor results', () => {
    const monitor: NormalizedUsage = {
      providerId: 'zai',
      kind: 'cost',
      windows,
      fetchedAt: 1_700_000_000_000,
    };
    expect(monitor.windows).toEqual(windows);
    expect(monitor.value).toBeUndefined();
    expect(monitor.currency).toBeUndefined();
  });

  it('monitor usage without value/currency does not render a monetary badge', () => {
    const monitor: NormalizedUsage = {
      providerId: 'zai',
      kind: 'cost',
      windows: { level: 'Pro' },
      fetchedAt: 1_700_000_000_000,
    };
    // No percentage and no monetary value: the honest badge is the level.
    expect(formatBadgeText(monitor)).toBe('Pro');
  });
});

describe('NormalizedUsage.plan (hito-8 §Qwen Plan Probe) — badge ignores it', () => {
  it('carries the plan status alongside the balance, with an optional reset instant', () => {
    const available = usage({ providerId: 'qwen', plan: { status: 'available' } });
    const exhausted = usage({ providerId: 'qwen', plan: { status: 'exhausted', resetAt: 1_788_656_274_505 } });
    const rejected = usage({ providerId: 'qwen', plan: { status: 'key-rejected' } });

    expect(available.plan).toEqual({ status: 'available' });
    expect(exhausted.plan).toEqual({ status: 'exhausted', resetAt: 1_788_656_274_505 });
    expect(rejected.plan).toEqual({ status: 'key-rejected' });
    expect(usage({ providerId: 'qwen' }).plan).toBeUndefined(); // optional like windows
  });

  it('formatBadgeText is byte-identical with and without plan status — the badge renders the balance', () => {
    const withoutPlan = usage({ providerId: 'qwen', value: 12.34, currency: 'USD' });
    const withPlan = usage({
      providerId: 'qwen',
      value: 12.34,
      currency: 'USD',
      plan: { status: 'exhausted', resetAt: 1_788_656_274_505 },
    });

    expect(formatBadgeText(withPlan)).toBe('$12');
    expect(formatBadgeText(withPlan)).toBe(formatBadgeText(withoutPlan));
  });
});

describe('formatBadgeText — windows branch (usage-badge §Badge Rendering)', () => {
  it('renders the 5h percentage uncapped as integer display text', () => {
    expect(formatBadgeText(usage({ windows: { fiveHour: { percentage: 137, total: 12_000 } } }))).toBe('137%');
    expect(formatBadgeText(usage({ windows: { fiveHour: { percentage: 100, total: 12_000 } } }))).toBe('100%');
  });

  it('rounds a fractional percentage for display only', () => {
    expect(formatBadgeText(usage({ windows: { fiveHour: { percentage: 12.5, total: 1_000 } } }))).toBe('13%');
    expect(formatBadgeText(usage({ windows: { fiveHour: { percentage: 0.4, total: 1_000 } } }))).toBe('0%');
  });

  it('falls back to the plan level when the 5h percentage is absent', () => {
    expect(formatBadgeText(usage({ windows: { level: 'Pro', fiveHour: { used: 100, total: 12_000 } } }))).toBe('Pro');
    expect(formatBadgeText(usage({ windows: { level: 'Lite' } }))).toBe('Lite');
  });

  it('renders an empty badge when both percentage and level are absent', () => {
    expect(formatBadgeText(usage({ windows: { fiveHour: { total: 12_000 } } }))).toBe('');
    expect(formatBadgeText(usage({ windows: {} }))).toBe('');
  });

  it('monetary results keep the existing rendering — windows take precedence only when present', () => {
    // Regression pair: identical monetary usage, with and without windows.
    expect(formatBadgeText(usage({ value: 12.34 }))).toBe('¥12');
    expect(formatBadgeText(usage({ value: 12.34, windows: { level: 'Pro' } }))).toBe('Pro');
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
