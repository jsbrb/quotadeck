// QwenQuotaStep tests (hito-12 WU-C2) — the tick-level two-hop quota flow,
// pinned against the live-verified contracts (docs/spike/endpoints.md
// §Qwen token-plan quota). Hermetic: FakeStorageArea keys, a routing transport
// double for the mint and gateway hosts, and a console.error spy for the
// one-line-per-class log discipline. The transient session token is a SYNTHETIC
// sentinel — every sweep asserts it never lands in storage, logs, or later
// ticks.
import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_RESPONSES } from '../fixtures';
import { AllowlistNetworkClient } from '../network/client';
import { HttpStatusError } from '../network/fetch-transport';
import { NetworkRejectionError } from '../network/request';
import type { AuthorizedRequest, Transport, TransportResponse } from '../network/transport';
import { QWEN_TOKEN_MINT_HOST, QWEN_TOKEN_PLAN_GATEWAY_HOST } from '../providers/qwen-token-plan';
import { KeyStore } from '../storage/key-store';
import { FakeBrowser } from '../testing/fake-browser';
import { QwenQuotaStep } from './qwen-quota';

const TICK_NOW = Date.UTC(2026, 9, 25, 12, 0, 0); // 2026-10-25T12:00:00Z — the live-capture day
const SENTINEL_A = 'sess-quota-transient-token-aaaa';
const SENTINEL_B = 'sess-quota-transient-token-bbbb';
const PAIR = { type: 'ak-sk', accessKeyId: 'LTAI5tQuotaFixtureAccessKey', accessKeySecret: 'quota-fixture-secret-never-real' } as const;

/** Success envelope wrapper for the live-shaped gateway body (T3 parse, WU-G data.success gate). */
function envelope(payload: unknown): unknown {
  return {
    code: '200',
    data: { success: true, DataV2: { data: { data: payload, success: true, failed: false } } },
  };
}

/** Mint answer with a fresh sentinel token each call — proves per-tick freshness. */
function mintOk(sentinel = SENTINEL_A): TransportResponse {
  return { status: 200, body: { cliAccessToken: sentinel, RequestId: 'req-mint-0001' } };
}

/**
 * Two-host routing double (FetchTransport-shaped status-first: scripted
 * failures THROW instead of answering). Records every dispatch for order and
 * header assertions.
 */
class QuotaFlowTransport implements Transport {
  readonly dispatches: AuthorizedRequest[] = [];
  private mintCalls = 0;

  constructor(
    private readonly mint: () => TransportResponse,
    private readonly usage: () => TransportResponse,
  ) {}

  probeCalls(): number {
    return this.mintCalls;
  }

  hosts(): string[] {
    return this.dispatches.map((request) => new URL(request.url).hostname);
  }

  async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
    this.dispatches.push(request);
    const host = new URL(request.url).hostname;
    if (host === QWEN_TOKEN_MINT_HOST) {
      this.mintCalls++;
      return this.mint();
    }
    if (host === QWEN_TOKEN_PLAN_GATEWAY_HOST) {
      return this.usage();
    }
    throw new Error(`unexpected quota-flow dispatch: ${request.url}`);
  }
}

async function makeStep(transport: Transport): Promise<{ step: QwenQuotaStep; local: FakeBrowser['local'] }> {
  const browser = new FakeBrowser();
  await new KeyStore(browser.local).saveCredential('qwen', PAIR);
  const step = new QwenQuotaStep({ client: new AllowlistNetworkClient(transport), keys: new KeyStore(browser.local) });
  return { step, local: browser.local };
}

/** Usage answer from a live-shaped envelope. */
const usageOk = () =>
  ({ status: 200, body: envelope({ per1MonthPercentage: 0.1172, per1MonthResetTime: 1_793_721_600_000 }) }) as TransportResponse;

describe('QwenQuotaStep — happy flow and shape (hito-12 WU-C2)', () => {
  it('mints then reads the gateway, returning the mapped quota with clock-pinned fetchedAt', async () => {
    const transport = new QuotaFlowTransport(() => mintOk(), usageOk);
    const { step } = await makeStep(transport);

    const quota = await step.resolve(TICK_NOW, 'international');

    expect(quota).toStrictEqual({ percentage: 11.72, resetAt: 1_793_721_600_000, fetchedAt: TICK_NOW });
    expect(transport.hosts()).toEqual([QWEN_TOKEN_MINT_HOST, QWEN_TOKEN_PLAN_GATEWAY_HOST]);
  });

  it('dispatch shape: ACS3-signed mint with body {}; gateway carries Bearer sentinel + form body, switchAgent never rides', async () => {
    const transport = new QuotaFlowTransport(() => mintOk(), usageOk);
    const { step } = await makeStep(transport);

    await step.resolve(TICK_NOW, 'international');

    const [mintCall, gatewayCall] = transport.dispatches;
    expect(mintCall!.body).toBe('{}');
    expect(mintCall!.headers.Authorization).toMatch(/^ACS3-HMAC-SHA256 Credential=LTAI5tQuotaFixtureAccessKey,/u);
    expect(gatewayCall!.headers.Authorization).toBe(`Bearer ${SENTINEL_A}`);
    expect(gatewayCall!.body).toContain('params={"Api"');
    expect(gatewayCall!.body).not.toContain('switchAgent');
    expect(gatewayCall!.url).toContain('api=zeldaHttp.apikeyMgr.%2Ftokenplan%2Fpersonal%2Fapi%2Fv2%2Fusage');
  });

  it('runs EVERY tick without a cache: two ticks mint twice and each uses its fresh token', async () => {
    let issued = 0;
    const transport = new QuotaFlowTransport(
      () => mintOk(++issued === 1 ? SENTINEL_A : SENTINEL_B),
      usageOk,
    );
    const { step } = await makeStep(transport);

    await step.resolve(TICK_NOW, 'international');
    const second = await step.resolve(TICK_NOW + 1, 'international');

    expect(transport.probeCalls()).toBe(2);
    expect(second).toStrictEqual({ percentage: 11.72, resetAt: 1_793_721_600_000, fetchedAt: TICK_NOW + 1 });
    expect(transport.dispatches[3]!.headers.Authorization).toBe(`Bearer ${SENTINEL_B}`); // not the first tick's token
  });

  it('passes an over-1 fraction through uncapped and maps a resetAt-only payload without percentage', async () => {
    const uncappedTransport = new QuotaFlowTransport(() => mintOk(), () =>
      ({ status: 200, body: envelope({ per1MonthPercentage: 1.5, per1MonthResetTime: 5 }) }) as TransportResponse);
    const uncapped = await (await makeStep(uncappedTransport)).step.resolve(TICK_NOW, 'international');
    expect(uncapped).toStrictEqual({ percentage: 150, resetAt: 5, fetchedAt: TICK_NOW });

    const resetOnlyTransport = new QuotaFlowTransport(() => mintOk(), () =>
      ({ status: 200, body: envelope({ per1MonthResetTime: 7 }) }) as TransportResponse);
    const resetOnly = await (await makeStep(resetOnlyTransport)).step.resolve(TICK_NOW, 'international');
    expect(resetOnly).toStrictEqual({ resetAt: 7, fetchedAt: TICK_NOW });
  });

  it('SWEEP — the minted token never lands in any storage write (fake browser captures all set calls)', async () => {
    const transport = new QuotaFlowTransport(() => mintOk(), usageOk);
    const browser = new FakeBrowser();
    await new KeyStore(browser.local).saveCredential('qwen', PAIR);
    const step = new QwenQuotaStep({ client: new AllowlistNetworkClient(transport), keys: new KeyStore(browser.local) });

    await step.resolve(TICK_NOW, 'international');

    expect(browser.local.snapshot()['qd:key:qwen']).not.toContain(SENTINEL_A);
    for (const call of browser.local.calls) {
      expect(JSON.stringify(call.args)).not.toContain(SENTINEL_A);
    }
    expect(JSON.stringify(browser.local.snapshot())).not.toContain(SENTINEL_A);
  });
});

describe('QwenQuotaStep — no-op gates (hito-12 WU-C2)', () => {
  it('china site no-ops: builders already answer null, so nothing dispatches', async () => {
    const transport = new QuotaFlowTransport(() => mintOk(), usageOk);
    const { step } = await makeStep(transport);

    await expect(step.resolve(TICK_NOW, 'china')).resolves.toBeUndefined();
    expect(transport.dispatches).toHaveLength(0);
  });

  it('missing stored qwen AK/SK no-ops without dispatch', async () => {
    const browser = new FakeBrowser(); // no keys saved
    const transport = new QuotaFlowTransport(() => mintOk(), usageOk);
    const step = new QwenQuotaStep({ client: new AllowlistNetworkClient(transport), keys: new KeyStore(browser.local) });

    await expect(step.resolve(TICK_NOW, 'international')).resolves.toBeUndefined();
    expect(transport.dispatches).toHaveLength(0);
  });
});

describe('QwenQuotaStep — failure classes: one log line, quota omitted, the tick survives', () => {
  const runFailing = async (mint: () => TransportResponse, usage: () => TransportResponse) => {
    const transport = new QuotaFlowTransport(mint, usage);
    const { step } = await makeStep(transport);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const quota = await step.resolve(TICK_NOW, 'international');
      expect(quota).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      return { args: errorSpy.mock.calls[0]!, text: JSON.stringify(errorSpy.mock.calls) };
    } finally {
      errorSpy.mockRestore();
    }
  };

  it('mint HTTP 401/403 → mint-rejected (NoPermission/auth) line with the vendor evidence', async () => {
    const { args, text } = await runFailing(
      () => {
        throw new HttpStatusError(403, '{"Code":"NoPermission","Message":"ram policy missing"}');
      },
      usageOk,
    );
    expect(args[0]).toBe('[quotadeck] qwen quota mint rejected (NoPermission/auth):');
    expect(String(args[1])).toContain('NoPermission');
    expect(text).not.toContain('sess-quota'); // nothing minted, nothing leaks
  });

  it('local rejection at the mint seam also classifies as mint-rejected (guard fired pre-wire)', async () => {
    const { args } = await runFailing(
      () => {
        throw new NetworkRejectionError('credential-placement', 'guard message');
      },
      usageOk,
    );
    expect(args[0]).toBe('[quotadeck] qwen quota mint rejected (NoPermission/auth):');
  });

  it('mint non-auth HTTP / parse / network failures → mint-failed line', async () => {
    const http500 = await runFailing(
      () => {
        throw new HttpStatusError(500);
      },
      usageOk,
    );
    expect(http500.args[0]).toBe('[quotadeck] qwen quota mint failed:');
    expect(String(http500.args[1])).toContain('HTTP 500');

    const noToken = await runFailing(() => ({ status: 200, body: { RequestId: 'req-only' } }), usageOk);
    expect(noToken.args[0]).toBe('[quotadeck] qwen quota mint failed:');
    expect(String(noToken.args[1])).toContain('QwenMintError');

    const network = await runFailing(
      () => {
        throw new TypeError('Failed to fetch');
      },
      usageOk,
    );
    expect(network.args[0]).toBe('[quotadeck] qwen quota mint failed:');
  });

  it('gateway 401/403 → re-auth-needed line naming ONLY the status — the body snippet never reaches the log', async () => {
    const { args, text } = await runFailing(
      () => mintOk(),
      () => {
        throw new HttpStatusError(401, `echo of ${SENTINEL_A} — hostile body`);
      },
    );
    expect(args).toHaveLength(1);
    expect(args[0]).toBe('[quotadeck] qwen quota gateway auth failed (re-auth needed): HTTP 401');
    expect(text).not.toContain(SENTINEL_A);
  });

  it('gateway body failure (ProviderApiError from the T3 parse) → gateway-body-failed line', async () => {
    const { args } = await runFailing(
      () => mintOk(),
      () => FIXTURE_RESPONSES['qwen/token-plan-usage--failed-envelope'],
    );
    expect(args[0]).toBe('[quotadeck] qwen quota gateway body failed:');
    expect(String(args[1])).toContain('ProviderApiError');
  });

  it('gateway transport failure → gateway-request-failed line', async () => {
    const { args } = await runFailing(
      () => mintOk(),
      () => {
        throw new TypeError('Failed to fetch');
      },
    );
    expect(args[0]).toBe('[quotadeck] qwen quota gateway request failed:');
  });

  it('a successful envelope answering BOTH fields absent is no-data: logged, quota omitted', async () => {
    const { args, text } = await runFailing(
      () => mintOk(),
      () => ({ status: 200, body: envelope({}) }) as TransportResponse,
    );
    expect(args).toHaveLength(1);
    expect(args[0]).toBe('[quotadeck] qwen quota gateway answered no data — quota omitted.');
    expect(text).not.toContain(SENTINEL_A); // no failure echo carries the token
  });
});
