import { describe, expect, it } from 'vitest';
import { DeepSeekProvider } from './deepseek';

// hito-13 WU-A — DeepSeek pay-as-you-go wallet parsing. Bodies mirror the
// live capture (2026-10-25, docs/spike/endpoints.md): ALL
// monetary figures arrive as decimal STRINGS and consumption is DERIVED —
// wallet total = topped_up + granted, consumed = total - total_balance,
// percentage = consumed / total * 100, UNCAPPED and omitted when total is 0.
const liveCapture = {
  is_available: true,
  balance_infos: [
    { currency: 'USD', total_balance: '2.00', granted_balance: '0.00', topped_up_balance: '2.00' },
  ],
};

describe('DeepSeekProvider (hito-13 WU-A)', () => {
  it('parses the live-captured USD body into a balance plus the derived wallet', () => {
    const parse = new DeepSeekProvider().parsePage(liveCapture, null);
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.providerId).toBe('deepseek');
      expect(parse.usage.kind).toBe('balance');
      expect(parse.usage.value).toBe(2);
      expect(parse.usage.currency).toBe('USD');
      expect(parse.usage.fetchedAt).toBe(0); // engine stamps the fold time (AD-1)
      expect(parse.usage.wallet).toEqual({ currency: 'USD', total: 2, consumed: 0, percentage: 0 });
    }
  });

  it('parses the CNY variant with its own denomination', () => {
    const parse = new DeepSeekProvider().parsePage(
      {
        is_available: true,
        balance_infos: [
          { currency: 'CNY', total_balance: '9.00', granted_balance: '1.00', topped_up_balance: '8.00' },
        ],
      },
      null,
    );
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.value).toBe(9);
      expect(parse.usage.currency).toBe('CNY');
      expect(parse.usage.wallet).toEqual({ currency: 'CNY', total: 9, consumed: 0, percentage: 0 });
    }
  });

  it('converts the decimal-STRING figures to numbers', () => {
    const parse = new DeepSeekProvider().parsePage(
      {
        is_available: true,
        balance_infos: [
          { currency: 'USD', total_balance: '123.45', granted_balance: '0.55', topped_up_balance: '100.00' },
        ],
      },
      null,
    );
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.value).toBe(123.45);
      expect(parse.usage.wallet?.total).toBe(100.55); // 100.00 + 0.55
      expect(parse.usage.wallet?.consumed).toBeCloseTo(-22.9); // negative passthrough, never clamped
    }
  });

  it('treats an absent granted_balance as 0 (tolerant parse)', () => {
    const parse = new DeepSeekProvider().parsePage(
      {
        is_available: true,
        balance_infos: [{ currency: 'USD', total_balance: '5.00', topped_up_balance: '5.00' }],
      },
      null,
    );
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.wallet).toEqual({ currency: 'USD', total: 5, consumed: 0, percentage: 0 });
    }
  });

  it('treats an absent topped_up_balance as 0 (tolerant parse)', () => {
    const parse = new DeepSeekProvider().parsePage(
      {
        is_available: true,
        balance_infos: [{ currency: 'USD', total_balance: '2.00', granted_balance: '2.00' }],
      },
      null,
    );
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.wallet).toEqual({ currency: 'USD', total: 2, consumed: 0, percentage: 0 });
    }
  });

  it('omits percentage when the wallet total is 0 (honest absence, no division by zero)', () => {
    const parse = new DeepSeekProvider().parsePage(
      {
        is_available: true,
        balance_infos: [
          { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' },
        ],
      },
      null,
    );
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.wallet).toEqual({ currency: 'USD', total: 0, consumed: 0 });
      expect(parse.usage.wallet && 'percentage' in parse.usage.wallet).toBe(false);
    }
  });

  it('derives consumed and the UNCAPPED percentage from topped_up + granted minus remaining', () => {
    const parse = new DeepSeekProvider().parsePage(
      {
        is_available: true,
        balance_infos: [
          { currency: 'CNY', total_balance: '4.00', granted_balance: '0.00', topped_up_balance: '10.00' },
        ],
      },
      null,
    );
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.wallet).toEqual({ currency: 'CNY', total: 10, consumed: 6, percentage: 60 });
    }
  });

  it('parses only the FIRST balance_infos entry', () => {
    const parse = new DeepSeekProvider().parsePage(
      {
        is_available: true,
        balance_infos: [
          { currency: 'USD', total_balance: '2.00', granted_balance: '0.00', topped_up_balance: '2.00' },
          { currency: 'CNY', total_balance: '999.00', granted_balance: '0.00', topped_up_balance: '999.00' },
        ],
      },
      null,
    );
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.currency).toBe('USD');
      expect(parse.usage.value).toBe(2);
      expect(parse.usage.wallet?.total).toBe(2);
    }
  });

  it('renders is_available: false as a STATE, not an error — figures still parse', () => {
    const parse = new DeepSeekProvider().parsePage(
      { ...liveCapture, is_available: false },
      null,
    );
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.value).toBe(2);
    }
  });

  it.each([
    ['the body is not an object', 'garbage'],
    ['balance_infos is missing', { is_available: true }],
    ['balance_infos is not an array', { is_available: true, balance_infos: 'none' }],
    ['balance_infos is empty', { is_available: true, balance_infos: [] }],
    ['the first entry is not an object', { is_available: true, balance_infos: [42] }],
    [
      'the first entry misses total_balance',
      { is_available: true, balance_infos: [{ currency: 'USD', granted_balance: '0.00' }] },
    ],
    [
      'the first entry misses currency',
      { is_available: true, balance_infos: [{ total_balance: '2.00', granted_balance: '0.00' }] },
    ],
    [
      'total_balance is non-string garbage',
      { is_available: true, balance_infos: [{ currency: 'USD', total_balance: { cents: 200 } }] },
    ],
    [
      'total_balance is an unparseable string',
      { is_available: true, balance_infos: [{ currency: 'USD', total_balance: 'many' }] },
    ],
  ])('throws an explicit endpoint+field error when %s', (_label, body) => {
    expect(() => new DeepSeekProvider().parsePage(body, null)).toThrow(/user\/balance/);
  });

  it('builds the documented GET /user/balance request with no query', () => {
    const request = new DeepSeekProvider().firstRequest({});
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://api.deepseek.com/user/balance');
    expect(request.query).toBeUndefined();
  });
});
