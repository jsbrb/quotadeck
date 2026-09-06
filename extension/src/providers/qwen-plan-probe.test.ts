// Qwen plan probe tests (provider-framework spec §Qwen Plan Probe; hito-8).
// PURE unit layer: the request builder and the status-first outcome mapper
// carry no I/O — dispatch belongs to refresh/qwen-plan.ts through the
// AllowlistNetworkClient (Bearer attach pinned in network/client.test.ts).
import { describe, expect, it } from 'vitest';
import { FIXTURE_RESPONSES } from '../fixtures';
import {
  buildPlanProbeRequest,
  QWEN_PLAN_PROBE_HOST,
  QWEN_PLAN_PROBE_MODEL,
  QWEN_PLAN_PROBE_URL,
  mapProbeOutcome,
  parseResetInstant,
} from './qwen-plan-probe';

/** 2026-09-06T08:00:00Z — the pinned clock instant for year-derivation cases. */
const NOW_MS = Date.UTC(2026, 8, 6, 8, 0, 0);

describe('buildPlanProbeRequest (spec §Qwen Plan Probe — request shape)', () => {
  it('builds the documented 1-token POST against the token-plan host', () => {
    const request = buildPlanProbeRequest();

    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(new URL(request.url).hostname).toBe(QWEN_PLAN_PROBE_HOST);
    expect(request.query).toBeUndefined(); // no query: nothing may smuggle into the URL
    expect(JSON.parse(request.body as string)).toEqual({
      model: QWEN_PLAN_PROBE_MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
    });
    expect(QWEN_PLAN_PROBE_MODEL).toBe('qwen3.6-flash');
  });

  it('carries NO credential material — the key attaches only via the client Bearer branch', () => {
    const request = buildPlanProbeRequest();
    const serialized = `${request.url}${request.body ?? ''}`;

    expect(serialized).not.toContain('sk-sp-');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Bearer');
  });

  it('is deterministic: identical builds are deep-equal', () => {
    expect(buildPlanProbeRequest()).toEqual(buildPlanProbeRequest());
  });
});

describe('mapProbeOutcome — status-first mapping (spec scenarios)', () => {
  it('2xx → available, no reset instant', () => {
    expect(mapProbeOutcome(200, undefined, NOW_MS)).toEqual({ status: 'available' });
    expect(mapProbeOutcome(204, undefined, NOW_MS)).toEqual({ status: 'available' });
  });

  it('429 with `reset at 09-06 10:00:00 UTC` → exhausted with the 2026 reset instant', () => {
    // hito-7 §Error Body Surfacing embeds the 429 body text in the message.
    const message = 'HTTP 429: {"Code":"Throttling","Message":"Requests throttled, quota reset at 09-06 10:00:00 UTC"}';
    const outcome = mapProbeOutcome(429, message, NOW_MS);

    expect(outcome).toEqual({ status: 'exhausted', resetAt: Date.UTC(2026, 8, 6, 10, 0, 0) });
  });

  it('a past-derived reset instant rolls to the following year', () => {
    const message = 'HTTP 429: reset at 01-15 00:00:00 UTC';
    const outcome = mapProbeOutcome(429, message, NOW_MS); // clock: 2026-09-06

    expect(outcome).toEqual({ status: 'exhausted', resetAt: Date.UTC(2027, 0, 15, 0, 0, 0) });
  });

  it('a 429 whose reset text is absent or unparseable still reports exhausted, without resetAt', () => {
    expect(mapProbeOutcome(429, 'HTTP 429: {"Code":"Throttling"}', NOW_MS)).toEqual({ status: 'exhausted' });
    expect(mapProbeOutcome(429, undefined, NOW_MS)).toEqual({ status: 'exhausted' });
    expect(mapProbeOutcome(429, 'HTTP 429: reset at 99-99 99:99:99 UTC', NOW_MS)).toEqual({ status: 'exhausted' });
  });

  it('401 and 403 → key-rejected', () => {
    expect(mapProbeOutcome(401, 'HTTP 401: InvalidApiKey', NOW_MS)).toEqual({ status: 'key-rejected' });
    expect(mapProbeOutcome(403, 'HTTP 403: Forbidden', NOW_MS)).toEqual({ status: 'key-rejected' });
  });

  it('any other status maps to undefined — the tick omits plan status and keeps the cache', () => {
    expect(mapProbeOutcome(500, 'HTTP 500', NOW_MS)).toBeUndefined();
    expect(mapProbeOutcome(302, undefined, NOW_MS)).toBeUndefined();
  });

  it('never synthesizes a percentage, total, or used figure (spec scenario)', () => {
    for (const outcome of [
      mapProbeOutcome(200, undefined, NOW_MS),
      mapProbeOutcome(429, 'reset at 09-06 10:00:00 UTC', NOW_MS),
      mapProbeOutcome(403, undefined, NOW_MS),
    ]) {
      expect(Object.keys(outcome!).sort()).toEqual(
        outcome!.resetAt === undefined ? ['status'] : ['resetAt', 'status'],
      );
    }
  });
});

describe('parseResetInstant — year from the injected clock', () => {
  it('derives the clock year and rolls past-derived instants to the next year', () => {
    expect(parseResetInstant('reset at 09-06 10:00:00 UTC', NOW_MS)).toBe(Date.UTC(2026, 8, 6, 10, 0, 0));
    expect(parseResetInstant('reset at 09-06 07:00:00 UTC', NOW_MS)).toBe(Date.UTC(2027, 8, 6, 7, 0, 0)); // past
    expect(parseResetInstant(undefined, NOW_MS)).toBeUndefined();
    expect(parseResetInstant('no reset text here', NOW_MS)).toBeUndefined();
  });
});

describe('fixture ↔ mapper contract', () => {
  it('the recorded 200 probe fixture maps to available', () => {
    const fixture = FIXTURE_RESPONSES['qwen/plan-probe--ok'];
    expect(fixture.status).toBe(200);
    expect(mapProbeOutcome(fixture.status, undefined, NOW_MS)).toEqual({ status: 'available' });
  });
});
