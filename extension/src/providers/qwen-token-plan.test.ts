// Qwen token-plan quota parse tests (hito-12 T3, envelope contract corrected
// in WU-G; evidence: docs/spike/endpoints.md §Qwen token-plan quota —
// session-token surface — discovered-live). PURE unit layer: the module takes
// an already-parsed body and answers a UsageWindow-shaped result — dispatch
// and the console access token belong to the background composition, never to
// this module.
//
// The parser contract is pinned by the REAL live usage capture (2026-10-25,
// international account): the inner success object carries
// { msg, code: 'SUCCESS', data, requestId, success: true } with NO failed
// field on this surface (failed:false belongs to the coding-plan commodity
// API — a DIFFERENT surface — so a PRESENT failed must be false defensively
// while an absent one is accepted). A live body-level failure answers INSIDE
// HTTP 200 with data.success:false + errorCode and NO DataV2 at all (the
// recorded --failed-envelope fixture).
import { describe, expect, it } from 'vitest';
import { ProviderApiError } from '../core/provider';
import { FIXTURE_RESPONSES } from '../fixtures';
import {
  mintQuotaTokenRequest,
  parseMintResponse,
  QwenMintError,
  parseTokenPlanUsage,
  tokenPlanUsageRequest,
} from './qwen-token-plan';

/** Real live payload (COMPLETE surface): raw float fraction + monthly reset instant. */
const LIVE_PAYLOAD = { per1MonthPercentage: 0.14557322303961778, per1MonthResetTime: 1_793_721_600_000 };

/** The mapped expectation for LIVE_PAYLOAD: 0.14557322303961778 × 100 is EXACT under IEEE-754. */
const LIVE_USAGE = { percentage: 14.557322303961778, resetAt: 1_793_721_600_000 };

/** Wraps a payload in the REAL live success envelope — the inner has NO failed field. */
function envelope(payload: unknown, code: unknown = '200'): unknown {
  return {
    code,
    data: {
      DataV2: {
        ret: ['SUCCESS::interface call succeeded'],
        data: { msg: 'Success.', code: 'SUCCESS', data: payload, success: true },
      },
      success: true,
      httpStatus: 200,
      errorCode: '',
      api: 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage',
      errorMsg: '',
    },
    httpStatusCode: '200',
    successResponse: true,
  };
}

describe('parseTokenPlanUsage — REAL live envelope mapping (2026-10-25 capture)', () => {
  it('maps the live capture: USED fraction × 100, resetAt verbatim, nothing synthesized', () => {
    const usage = parseTokenPlanUsage(FIXTURE_RESPONSES['qwen/token-plan-usage--ok'].body);

    expect(usage.percentage).toBe(14.557322303961778); // 0.14557322303961778 × 100 — exact under IEEE-754
    expect(usage.resetAt).toBe(1_793_721_600_000);
    // NEVER synthesizes used/total/remaining: at most these two keys exist.
    expect(Object.keys(usage).sort()).toEqual(['percentage', 'resetAt']);
  });

  it('the recorded inner success object pins the surface: success true, code SUCCESS, NO failed field', () => {
    const body = FIXTURE_RESPONSES['qwen/token-plan-usage--ok'].body as {
      data: { DataV2: { data: Record<string, unknown> } };
    };
    const inner = body.data.DataV2.data;

    expect(inner.success).toBe(true);
    expect(inner.code).toBe('SUCCESS');
    expect(inner.msg).toBe('Success.');
    expect('failed' in inner).toBe(false); // failed:false belongs to the coding-plan surface
  });

  it('accepts the gateway code as numeric 200 or string "200" (qwen.ts-style tolerance)', () => {
    expect(parseTokenPlanUsage(envelope(LIVE_PAYLOAD, '200'))).toStrictEqual(LIVE_USAGE);
    expect(parseTokenPlanUsage(envelope(LIVE_PAYLOAD, 200))).toStrictEqual(LIVE_USAGE);
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
      parseTokenPlanUsage(envelope({ per1MonthPercentage: '0.14557322303961778', per1MonthResetTime: '1793721600000' })),
    ).toStrictEqual({});
  });

  it('a successful envelope whose payload is absent or garbage yields absent fields — no crash', () => {
    expect(parseTokenPlanUsage(envelope(undefined))).toStrictEqual({});
    expect(parseTokenPlanUsage(envelope('not-an-object'))).toStrictEqual({});
  });
});

describe('parseTokenPlanUsage — status-first validation (real live contract)', () => {
  it('the recorded Bad Request failure (data.success:false, NO DataV2) throws ProviderApiError (server per AD-21)', () => {
    const body = FIXTURE_RESPONSES['qwen/token-plan-usage--failed-envelope'].body;

    expect(() => parseTokenPlanUsage(body)).toThrow(ProviderApiError);
    expect(() => parseTokenPlanUsage(body)).toThrow(/data.success must be true/i);
  });

  it('inner success:false or absent rejects — the inner flag is required', () => {
    const innerFalse = {
      code: '200',
      data: { DataV2: { data: { msg: 'Success.', code: 'SUCCESS', data: LIVE_PAYLOAD, success: false } }, success: true },
    };
    const innerAbsent = {
      code: '200',
      data: { DataV2: { data: { msg: 'Success.', code: 'SUCCESS', data: LIVE_PAYLOAD } }, success: true },
    };

    expect(() => parseTokenPlanUsage(innerFalse)).toThrow(ProviderApiError);
    expect(() => parseTokenPlanUsage(innerFalse)).toThrow(/inner success must be true/i);
    expect(() => parseTokenPlanUsage(innerAbsent)).toThrow(ProviderApiError);
  });

  it('a PRESENT failed must be false: failed:true rejects; failed:false (the coding-plan commodity shape) still parses', () => {
    const failedTrue = {
      code: '200',
      data: { DataV2: { data: { data: LIVE_PAYLOAD, success: true, failed: true } }, success: true },
    };
    const failedFalse = {
      code: '200',
      data: { DataV2: { data: { data: LIVE_PAYLOAD, success: true, failed: false } }, success: true },
    };

    expect(() => parseTokenPlanUsage(failedTrue)).toThrow(ProviderApiError);
    expect(() => parseTokenPlanUsage(failedTrue)).toThrow(/failed must be false/i);
    expect(parseTokenPlanUsage(failedFalse)).toStrictEqual(LIVE_USAGE);
  });

  it('a data.success:true envelope WITHOUT DataV2 rejects', () => {
    const noDataV2 = { code: '200', data: { success: true, httpStatus: 200, errorCode: '', errorMsg: '' } };

    expect(() => parseTokenPlanUsage(noDataV2)).toThrow(ProviderApiError);
    expect(() => parseTokenPlanUsage(noDataV2)).toThrow(/DataV2/i);
  });

  it('a non-200 code rejects even when the flags say success', () => {
    expect(() => parseTokenPlanUsage(envelope(LIVE_PAYLOAD, '500'))).toThrow(ProviderApiError);
    expect(() => parseTokenPlanUsage(envelope(LIVE_PAYLOAD, '500'))).toThrow(/code must be 200/i);
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

// WU-C1 request builders + mint response parse. Contracts are live-verified
// 2026-10-25 (docs/spike/endpoints.md §Qwen token-plan quota): hop 1 mints a
// session token via the ACS3-marked ak-sk request; hop 2 rides the gateway
// with the transient token on the session marker ONLY. International is the
// single site with live evidence — china builders answer null, never a guess.
describe('mintQuotaTokenRequest — hop 1 (ACS3-marked mint)', () => {
  it('builds the exact live-proven mint request descriptor for international', () => {
    expect(mintQuotaTokenRequest('international')).toStrictEqual({
      method: 'POST',
      url: 'https://modelstudio.ap-southeast-1.aliyuncs.com/modelstudio/cli/generateAccessToken',
      body: '{}',
      signing: { scheme: 'acs3', action: 'GenerateCLIAccessToken', version: '2026-02-10' },
    });
  });

  it('returns null for the china site — no live-verified surface, no guessed hosts', () => {
    expect(mintQuotaTokenRequest('china')).toBeNull();
  });

  it('the descriptor carries no credential material — the AK/SK never enter the request', () => {
    const request = mintQuotaTokenRequest('international')!;
    const text = JSON.stringify(request);
    expect(text).not.toContain('accessKey');
    expect(text).not.toContain('Secret');
  });
});

describe('tokenPlanUsageRequest — hop 2 (session-bearer gateway)', () => {
  const SENTINEL_TOKEN = 'sess-synthetic-transient-token-9f3c';

  it('builds the exact live-verified gateway request for international', () => {
    const request = tokenPlanUsageRequest(SENTINEL_TOKEN, 'international')!;

    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://bailian-singapore-cs.alibabacloud.com/cli/api.json');
    // The client's buildUrl encodes this trio into the exact live URL
    // (action=IntlBroadScopeAspnGateway&product=sfm_bailian&api=<encoded>).
    expect(request.query).toStrictEqual({
      action: 'IntlBroadScopeAspnGateway',
      product: 'sfm_bailian',
      api: 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage',
    });
    expect(request.body).toBe(
      'params={"Api":"zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage","V":"1.0","Data":{"cornerstoneParam":{"protocol":"V2","console":"ONE_CONSOLE","productCode":"p_efm","switchUserType":3,"consoleSite":"BAILIAN_ALIYUN"}}}&region=ap-southeast-1',
    );
    expect(request.session).toStrictEqual({ token: SENTINEL_TOKEN });
  });

  it('TESTED PROPERTY — the body never contains switchAgent (omitted: SUCCESS, switchAgent:0: Workspace.NotAuthorised)', () => {
    const request = tokenPlanUsageRequest(SENTINEL_TOKEN, 'international')!;
    expect(request.body).toBeDefined();
    expect(request.body!).not.toContain('switchAgent');
    expect(JSON.stringify(request)).not.toContain('switchAgent');
  });

  it('the session token rides ONLY on the marker — never url, query, or body', () => {
    const request = tokenPlanUsageRequest(SENTINEL_TOKEN, 'international')!;

    expect(request.url).not.toContain(SENTINEL_TOKEN);
    expect(JSON.stringify(request.query ?? {})).not.toContain(SENTINEL_TOKEN);
    expect(request.body ?? '').not.toContain(SENTINEL_TOKEN);
  });

  it('returns null for the china site — the token is not even placed on a request', () => {
    expect(tokenPlanUsageRequest(SENTINEL_TOKEN, 'china')).toBeNull();
  });
});

describe('parseMintResponse — cliAccessToken extraction, sanitized failures', () => {
  it('returns the token on the live success shape (other fields tolerated)', () => {
    expect(parseMintResponse({ cliAccessToken: 'sess-live-token-0001', RequestId: 'req-42' })).toBe(
      'sess-live-token-0001',
    );
  });

  it('missing, empty, or non-string cliAccessToken throws QwenMintError surfacing at most Code/Message', () => {
    expect(() => parseMintResponse({ RequestId: 'req-42' })).toThrow(QwenMintError);
    expect(() => parseMintResponse({ cliAccessToken: '' })).toThrow(QwenMintError);
    expect(() => parseMintResponse({ cliAccessToken: 42 })).toThrow(QwenMintError);
    expect(() => parseMintResponse(null)).toThrow(QwenMintError);

    expect(() => parseMintResponse({ Code: 'Forbidden', Message: 'no workspace role' })).toThrow(
      /Forbidden: no workspace role/u,
    );
  });

  it('SENTINEL SWEEP — the error never echoes the raw body, RequestId, or token-shaped material', () => {
    const body = {
      cliAccessToken: '',
      RequestId: 'req-secret-ish-9e1d',
      Code: 'BailianGateway.Workspace.NotAuthorised',
      Message: 'missing membership',
    };
    try {
      parseMintResponse(body);
      expect.unreachable('the empty token must reject');
    } catch (error) {
      const text = `${(error as Error).name}: ${(error as Error).message}`;
      expect(text).toContain('BailianGateway.Workspace.NotAuthorised');
      expect(text).not.toContain('req-secret-ish-9e1d'); // never echoes non-contract fields
      expect(text).not.toContain('RequestId');
      expect(text).not.toContain(JSON.stringify(body)); // never echoes the raw body
    }
  });
});
