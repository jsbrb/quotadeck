// Qwen token-plan quota parse tests (hito-12 T3; evidence:
// docs/spike/endpoints.md §Qwen token-plan quota — session-token surface —
// discovered-live, the 2026-10-25 maintainer live capture). PURE unit layer:
// the module takes an already-parsed body and answers a UsageWindow-shaped
// result — dispatch and the console access token belong to the background
// composition, never to this module.
import { describe, expect, it } from 'vitest';
import { ProviderApiError } from '../core/provider';
import { FIXTURE_RESPONSES } from '../fixtures';
import { parseTokenPlanUsage } from './qwen-token-plan';

/** Live-capture payload (COMPLETE surface): 11.72% used, monthly reset instant. */
const LIVE_PAYLOAD = { per1MonthPercentage: 0.1172, per1MonthResetTime: 1_793_721_600_000 };

/** Wraps a payload in the live-shaped success envelope (code defaults to string "200"). */
function envelope(payload: unknown, code: unknown = '200'): unknown {
  return {
    code,
    data: {
      DataV2: {
        ret: ['SUCCESS::interface call succeeded'],
        data: { data: payload, success: true, failed: false },
      },
      success: true,
      httpStatus: 200,
    },
    httpStatusCode: '200',
    successResponse: true,
  };
}

describe('parseTokenPlanUsage — live envelope and mapping (docs/spike/endpoints.md)', () => {
  it('maps the 0..1 USED fraction to the 0-100 convention and carries resetAt verbatim', () => {
    const usage = parseTokenPlanUsage(FIXTURE_RESPONSES['qwen/token-plan-usage--ok'].body);

    expect(usage.percentage).toBe(11.72); // 0.1172 × 100 — exact under IEEE-754
    expect(usage.resetAt).toBe(1_793_721_600_000);
    // NEVER synthesizes used/total/remaining: at most these two keys exist.
    expect(Object.keys(usage).sort()).toEqual(['percentage', 'resetAt']);
  });

  it('accepts the gateway code as numeric 200 or string "200" (qwen.ts-style tolerance)', () => {
    const expected = { percentage: 11.72, resetAt: 1_793_721_600_000 };

    expect(parseTokenPlanUsage(envelope(LIVE_PAYLOAD, '200'))).toStrictEqual(expected);
    expect(parseTokenPlanUsage(envelope(LIVE_PAYLOAD, 200))).toStrictEqual(expected);
  });

  it('passes an over-1 fraction through UNCAPPED (server 1.5 stays 150, never clamped)', () => {
    expect(parseTokenPlanUsage(envelope({ per1MonthPercentage: 1.5 }))).toStrictEqual({ percentage: 150 });
  });

  it('maps a zero fraction to a present 0 percentage (finite → not absent)', () => {
    expect(parseTokenPlanUsage(envelope({ per1MonthPercentage: 0 }))).toStrictEqual({ percentage: 0 });
  });
});

describe('parseTokenPlanUsage — honest absence', () => {
  it('a recorded payload without per1MonthPercentage reports resetAt only', () => {
    const usage = parseTokenPlanUsage(FIXTURE_RESPONSES['qwen/token-plan-usage--missing-pct'].body);

    expect(usage).toStrictEqual({ resetAt: 1_793_721_600_000 });
  });

  it('absent, null, non-finite or string values suppress their field', () => {
    expect(parseTokenPlanUsage(envelope({}))).toStrictEqual({});
    expect(
      parseTokenPlanUsage(envelope({ per1MonthPercentage: null, per1MonthResetTime: null })),
    ).toStrictEqual({});
    expect(
      parseTokenPlanUsage(envelope({ per1MonthPercentage: Number.NaN, per1MonthResetTime: Number.POSITIVE_INFINITY })),
    ).toStrictEqual({});
    // The live capture answers JSON NUMBERS; decimal strings are not a known
    // serialization of this surface, so a typed string stays absent.
    expect(
      parseTokenPlanUsage(envelope({ per1MonthPercentage: '0.1172', per1MonthResetTime: '1793721600000' })),
    ).toStrictEqual({});
  });

  it('a successful envelope whose payload is absent or garbage yields absent fields — no crash', () => {
    expect(parseTokenPlanUsage(envelope(undefined))).toStrictEqual({});
    expect(parseTokenPlanUsage(envelope('not-an-object'))).toStrictEqual({});
  });
});

describe('parseTokenPlanUsage — status-first envelope validation', () => {
  it('the recorded failed envelope (code "400") throws ProviderApiError (server per AD-21)', () => {
    const body = FIXTURE_RESPONSES['qwen/token-plan-usage--failed-envelope'].body;

    expect(() => parseTokenPlanUsage(body)).toThrow(ProviderApiError);
    expect(() => parseTokenPlanUsage(body)).toThrow(/code must be 200/i);
  });

  it('inner success:false or failed:true rejects as ProviderApiError even with code "200"', () => {
    const notSuccess = {
      code: '200',
      data: { DataV2: { data: { data: LIVE_PAYLOAD, success: false, failed: false } }, success: true },
    };
    const failedFlag = {
      code: '200',
      data: { DataV2: { data: { data: LIVE_PAYLOAD, success: true, failed: true } }, success: true },
    };

    expect(() => parseTokenPlanUsage(notSuccess)).toThrow(ProviderApiError);
    expect(() => parseTokenPlanUsage(notSuccess)).toThrow(/success must be true/i);
    expect(() => parseTokenPlanUsage(failedFlag)).toThrow(ProviderApiError);
    expect(() => parseTokenPlanUsage(failedFlag)).toThrow(/failed must be false/i);
  });

  it('a non-200 code rejects even when the inner flags say success', () => {
    expect(() => parseTokenPlanUsage(envelope(LIVE_PAYLOAD, '500'))).toThrow(ProviderApiError);
  });

  it('a non-object body rejects — the envelope cannot be validated', () => {
    expect(() => parseTokenPlanUsage(null)).toThrow(ProviderApiError);
    expect(() => parseTokenPlanUsage('plain text')).toThrow(ProviderApiError);
  });
});

describe('fixture ↔ parser contract', () => {
  it('all three token-plan fixtures ride HTTP-200 envelopes (body decides success)', () => {
    expect(FIXTURE_RESPONSES['qwen/token-plan-usage--ok'].status).toBe(200);
    expect(FIXTURE_RESPONSES['qwen/token-plan-usage--missing-pct'].status).toBe(200);
    // The gateway reports body-level failures inside an HTTP-200 response.
    expect(FIXTURE_RESPONSES['qwen/token-plan-usage--failed-envelope'].status).toBe(200);
  });
});
