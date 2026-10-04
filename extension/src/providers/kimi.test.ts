import { describe, expect, it } from 'vitest';
import { FIXTURE_RESPONSES } from '../fixtures';
import { KimiProvider } from './kimi';

describe('KimiProvider (spec §Kimi Parsing)', () => {
  it('parses data.available_balance as a CNY balance', () => {
    const parse = new KimiProvider().parsePage(
      FIXTURE_RESPONSES['kimi/users-me-balance--ok'].body,
      null,
    );
    expect(parse.done).toBe(true);
    if (parse.done) {
      expect(parse.usage.providerId).toBe('kimi');
      expect(parse.usage.kind).toBe('balance');
      expect(parse.usage.value).toBe(88.88);
      expect(parse.usage.currency).toBe('CNY');
    }
  });

  it('builds the documented GET /v1/users/me/balance request with no query', () => {
    const request = new KimiProvider().firstRequest({});
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://api.moonshot.cn/v1/users/me/balance');
    expect(request.query).toBeUndefined();
  });

  it('throws an explicit error when data.available_balance is missing', () => {
    const provider = new KimiProvider();
    expect(() => provider.parsePage({ code: 0, message: 'ok', data: {} }, null)).toThrow(
      /data\.available_balance/,
    );
  });
});
