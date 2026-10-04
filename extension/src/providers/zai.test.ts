import { describe, expect, it } from 'vitest';
import { ProviderApiError, type UsageQuery } from '../core/provider';
import { FIXTURE_RESPONSES } from '../fixtures';
import { AllowlistNetworkClient } from '../network/client';
import { FakeClock } from '../testing/fake-clock';
import { driveRefresh } from '../testing/provider-refresh';
import { RecordingTransport } from '../testing/recording-transport';
import { zaiMonitorBaseUrl } from '../core/zai-platforms';
import { ZaiProvider } from './zai';

// Hermetic (spec §Fixture-Only Data): every scenario parses recorded monitor
// fixtures through the real AllowlistNetworkClient against a
// RecordingTransport — no network I/O can occur. The ZAI monitor refresh is
// single-shot, so every driveRefresh queues exactly one response; the raw
// credential comes from TEST_CREDENTIALS keyed by provider.credentialType.
const MONITOR_URL = `${zaiMonitorBaseUrl('zai')}/api/monitor/usage/quota/limit`;
const ZHIPU_MONITOR_URL = `${zaiMonitorBaseUrl('zhipu')}/api/monitor/usage/quota/limit`;
const QUERY: UsageQuery = { zaiPlatform: 'zai' };

describe('ZaiProvider — single-shot monitor query (§Single-Shot Monitor Query)', () => {
  it('issues exactly one GET to /api/monitor/usage/quota/limit — no query, no body', async () => {
    const transport = new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--pro-plan']]);

    await driveRefresh(new ZaiProvider(), QUERY, new AllowlistNetworkClient(transport), new FakeClock());

    expect(transport.requests).toHaveLength(1);
    const sent = transport.requests[0]!;
    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(MONITOR_URL);
    expect(sent.url).not.toContain('?'); // no pagination/window parameters
    expect(sent.body).toBeUndefined(); // no request body
  });

  it('attaches the raw credential verbatim with Accept-Language (§Raw Authorization)', async () => {
    const transport = new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--pro-plan']]);

    await driveRefresh(new ZaiProvider(), QUERY, new AllowlistNetworkClient(transport), new FakeClock());

    const sent = transport.requests[0]!;
    expect(sent.headers.Authorization).toBe('test-driver-credential'); // verbatim — no Bearer prefix
    expect(sent.headers.Authorization).not.toContain('Bearer');
    expect(sent.headers['Accept-Language']).toBeDefined();
  });
});

describe('ZaiProvider — platform binding (§Platform Binding)', () => {
  it('defaults to api.z.ai when no platform is selected', () => {
    expect(new ZaiProvider().firstRequest({})).toEqual({ method: 'GET', url: MONITOR_URL });
  });

  it('switches the base URL to open.bigmodel.cn for the zhipu platform', async () => {
    const transport = new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--pro-plan']]);

    await driveRefresh(
      new ZaiProvider(),
      { zaiPlatform: 'zhipu' },
      new AllowlistNetworkClient(transport),
      new FakeClock(),
    );

    expect(transport.requests[0]!.url).toBe(ZHIPU_MONITOR_URL);
  });

  it('throws on an invalid zaiPlatform before any dispatch', async () => {
    const provider = new ZaiProvider();
    const transport = new RecordingTransport(); // empty queue: any dispatch would throw

    expect(() => provider.firstRequest({ zaiPlatform: 'grok' as unknown as UsageQuery['zaiPlatform'] })).toThrow(
      /zaiPlatform.*(zai|zhipu)/i,
    );
    await expect(
      driveRefresh(
        provider,
        { zaiPlatform: 'grok' as unknown as UsageQuery['zaiPlatform'] },
        new AllowlistNetworkClient(transport),
        new FakeClock(),
      ),
    ).rejects.toThrow(/zaiPlatform/i);
    expect(transport.requests).toHaveLength(0); // zero I/O — rejected pre-dispatch
  });
});

// Live capture (2026-09-05, maintainer plan "pro", api.z.ai) — the pinning
// payload for the real wire shape: entries under `data.limits` (NOT
// tokenLimits), a TOKENS_LIMIT carrying percentage + nextResetTime with NO
// total, and usageDetails as an ARRAY of {modelCode, usage} entries. Kept
// verbatim (field order included) so no fixture drift can dilute the pin.
const LIVE_PRO_PAYLOAD = {
  code: 200,
  msg: 'Operation successful',
  data: {
    limits: [
      {
        type: 'TIME_LIMIT',
        unit: 5,
        number: 1,
        usage: 1000,
        currentValue: 0,
        remaining: 1000,
        percentage: 0,
        nextResetTime: 1790507835998,
        usageDetails: [
          { modelCode: 'search-prime', usage: 0 },
          { modelCode: 'web-reader', usage: 0 },
          { modelCode: 'zread', usage: 0 },
        ],
      },
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 32, nextResetTime: 1788656274505 },
    ],
    level: 'pro',
  },
  success: true,
} as const;

describe('ZaiProvider — live-captured plan-pro payload (2026-09-05 pinning)', () => {
  it('parses the real wire shape: limits field, total-less 5h window, array usageDetails', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([{ status: 200, body: LIVE_PRO_PAYLOAD }])),
      new FakeClock(),
    );

    expect(usage.windows?.level).toBe('pro');
    expect(usage.windows?.fiveHour).toStrictEqual({
      percentage: 32,
      resetAt: 1_788_656_274_505,
    }); // real 5h entry has no total → no total, no derived used
    expect(usage.windows?.weekly).toBeUndefined(); // single TOKENS_LIMIT: no positional fallback once 5h is discriminated
    expect(usage.windows?.mcp).toStrictEqual({
      used: 0, // currentValue
      ceiling: 1000, // usage
      tools: [
        { name: 'search-prime', used: 0 },
        { name: 'web-reader', used: 0 },
        { name: 'zread', used: 0 },
      ],
    });
  });

  it('ignores non-object usageDetails entries and skips entries with neither percentage nor total', async () => {
    const payload = {
      ...LIVE_PRO_PAYLOAD,
      data: {
        ...LIVE_PRO_PAYLOAD.data,
        limits: [
          // Non-object detail rows must not break MCP parsing.
          {
            type: 'TIME_LIMIT',
            usage: 100,
            currentValue: 4,
            usageDetails: ['nonsense', 42, null, { modelCode: 'zread', usage: 4 }],
          },
          // Discriminated but empty: percentage absent AND total absent → skipped.
          { type: 'TOKENS_LIMIT', unit: 6, number: 1, nextResetTime: 1788656274505 },
        ],
      },
    };
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([{ status: 200, body: payload }])),
      new FakeClock(),
    );

    expect(usage.windows?.mcp).toStrictEqual({
      used: 4,
      ceiling: 100,
      tools: [{ name: 'zread', used: 4 }],
    });
    expect(usage.windows?.weekly).toBeUndefined(); // empty entry skipped, not rendered
    expect(usage.windows?.fiveHour).toBeUndefined();
  });
});

describe('ZaiProvider — level and window discrimination (§Level and Window Discrimination)', () => {
  it('maps unit 3/number 5 to the 5h window; a lone TOKENS_LIMIT leaves weekly absent', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--pro-plan']])),
      new FakeClock(),
    );

    expect(usage.windows?.level).toBe('pro');
    expect(usage.windows?.fiveHour).toStrictEqual({ percentage: 32, resetAt: 1_788_656_274_505 });
    // Single TOKENS_LIMIT: 5h WAS discriminated, so positional fallback must
    // not fire and weekly stays absent (live-pinned behavior).
    expect(usage.windows?.weekly).toBeUndefined();
  });

  it('falls back to position when entries omit unit/number: [0] → 5h, [1] → weekly', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--fallback-position']])),
      new FakeClock(),
    );

    expect(usage.windows?.fiveHour).toStrictEqual({
      percentage: 30,
      used: 300,
      total: 1000,
      resetAt: 1_788_066_000_000,
    });
    expect(usage.windows?.weekly).toStrictEqual({ percentage: 10, used: 200, total: 2000 });
  });

  it('reports the MCP window alone without error when only TIME_LIMIT exists', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--mcp-only']])),
      new FakeClock(),
    );

    expect(usage.windows?.level).toBe('Pro');
    expect(usage.windows?.fiveHour).toBeUndefined();
    expect(usage.windows?.weekly).toBeUndefined();
    // Array usageDetails arrive unsorted (web-search first); output is name-sorted.
    expect(usage.windows?.mcp).toStrictEqual({
      used: 3,
      ceiling: 60,
      tools: [
        { name: 'deep-research', used: 1 },
        { name: 'web-search', used: 2 },
      ],
    });
  });
});

describe('ZaiProvider — percentage passthrough and used derivation (§Percentage Passthrough)', () => {
  it('passes the 137% percentage through uncapped and derives used 16440 from total 12000', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--over-100']])),
      new FakeClock(),
    );

    expect(usage.windows?.fiveHour?.percentage).toBe(137); // uncapped — NOT 100
    expect(usage.windows?.fiveHour?.used).toBe(16_440); // round(12000 × 137 / 100)
    expect(usage.windows?.fiveHour?.total).toBe(12_000);
    // Weekly u6/n1 discrimination with total: derived used stays covered here.
    expect(usage.windows?.weekly).toStrictEqual({
      percentage: 64,
      used: 83_200, // round(130000 × 64 / 100)
      total: 130_000,
      resetAt: 1_788_576_000_000,
    });
    expect(usage.windows?.mcp).toBeDefined();
  });

  it('reports a null percentage as absent percentage AND absent derived used', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--null-pct']])),
      new FakeClock(),
    );

    expect(usage.windows?.fiveHour).toStrictEqual({ total: 12_000 }); // no percentage, no used
    expect(usage.windows?.weekly).toStrictEqual({ percentage: 5, used: 6500, total: 130_000 });
  });
});

describe('ZaiProvider — reset countdown basis (§Reset Countdown)', () => {
  it('carries nextResetTime verbatim as resetAt (epoch ms) for the countdown', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--over-100']])),
      new FakeClock(),
    );

    expect(usage.windows?.fiveHour?.resetAt).toBe(1_788_069_600_000);
    expect(usage.windows?.weekly?.resetAt).toBe(1_788_576_000_000);
  });

  it('keeps windows reporting when nextResetTime is absent — countdown gracefully absent', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--null-pct']])),
      new FakeClock(),
    );

    expect(usage.windows?.fiveHour?.resetAt).toBeUndefined();
    expect(usage.windows?.weekly?.resetAt).toBeUndefined();
    expect(usage.windows?.level).toBe('Lite'); // the windows still report
  });
});

describe('ZaiProvider — monthly MCP window (§Monthly MCP Window)', () => {
  it('parses the live array usageDetails ({modelCode, usage}) with per-tool entries name-sorted', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--pro-plan']])),
      new FakeClock(),
    );

    expect(usage.windows?.mcp).toStrictEqual({
      used: 0, // currentValue
      ceiling: 1000, // usage
      tools: [
        { name: 'search-prime', used: 0 }, // name-sorted for determinism
        { name: 'web-reader', used: 0 },
        { name: 'zread', used: 0 },
      ],
    });
  });

  it('never synthesizes a percentage or countdown for the MCP window', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--pro-plan']])),
      new FakeClock(),
    );

    const mcp = usage.windows?.mcp as unknown as Record<string, unknown>;
    expect(mcp.percentage).toBeUndefined();
    expect(mcp.resetAt).toBeUndefined();
    expect(Object.keys(mcp).sort()).toEqual(['ceiling', 'tools', 'used']); // no extra fields
  });
});

describe('ZaiProvider — envelope discipline and result shape', () => {
  it('rejects a string "200" code with a ProviderApiError', () => {
    const provider = new ZaiProvider();
    provider.firstRequest(QUERY);
    const rejection = () =>
      provider.parsePage(FIXTURE_RESPONSES['zai/monitor--code-string-200'].body, null);
    expect(rejection).toThrow(/numeric code 200.*got string "200"/i);
    expect(rejection).toThrow(ProviderApiError); // body-level failure classifies as `server` (AD-21)
  });

  it('emits kind cost with windows and no monetary/tier fields', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      QUERY,
      new AllowlistNetworkClient(new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--pro-plan']])),
      new FakeClock(),
    );

    expect(usage.providerId).toBe('zai');
    expect(usage.kind).toBe('cost');
    expect(usage.value).toBeUndefined(); // the monitor endpoint reports no monetary figure
    expect(usage.currency).toBeUndefined();
    expect(usage.tier).toBeUndefined(); // level supersedes tier (AD-26)
    expect(usage.windows).toBeDefined();
  });

  it('declares the raw credential type (AD-25/27)', () => {
    expect(new ZaiProvider().credentialType).toBe('raw');
  });
});
