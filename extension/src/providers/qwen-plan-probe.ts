// Qwen token-plan probe (provider-framework spec §Qwen Plan Probe; hito-8).
//
// PURE model — no I/O. `buildPlanProbeRequest` shapes the 1-token probe
// request; `mapProbeOutcome` is the status-first outcome mapper over the
// transport's signals: a 2xx response body, or the `HttpStatusError` the
// transport throws for non-2xx (hito-7 §Error Body Surfacing embeds the 429
// body text — the reset instant is parsed from THAT message, not from
// headers: widening the transport port for one field is not worth the
// surface). Dispatch belongs to refresh/qwen-plan.ts, which sends this
// request through the AllowlistNetworkClient — the client attaches the
// `sk-sp-` key as the Bearer header; the request itself carries no
// credential material.
//
// No percentage or total is ever synthesized: the plan surface exposes none.
import type { PlanInfo } from '../core/usage';
import type { ProviderRequest } from '../network/request';

/** The single token-plan probe endpoint (community-verified; see docs/spike/endpoints.md). */
export const QWEN_PLAN_PROBE_URL = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions';

/** Hostname of the probe endpoint — the ONLY host where a plan key may attach. */
export const QWEN_PLAN_PROBE_HOST = 'token-plan.ap-southeast-1.maas.aliyuncs.com';

/** Cheapest model the plan surface admits; each probe costs one completion token. */
export const QWEN_PLAN_PROBE_MODEL = 'qwen3.6-flash';

/** Builds the documented 1-token probe request; deterministic and credential-free. */
export function buildPlanProbeRequest(): ProviderRequest {
  return {
    method: 'POST',
    url: QWEN_PLAN_PROBE_URL,
    body: JSON.stringify({
      model: QWEN_PLAN_PROBE_MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
    }),
  };
}

/** `reset at MM-DD HH:MM:SS UTC` — pinned to the observed 429 body text format. */
const RESET_TEXT_PATTERN = /reset at (\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC/u;

/**
 * Parses the reset instant from a surfaced 429 message. The text carries no
 * year: the year derives from the injected clock, and a past-derived instant
 * rolls to the following year (the reset is always ahead of `nowMs`).
 * Unparseable or absent text → `undefined` (exhausted without a reset).
 */
export function parseResetInstant(errorMessage: string | undefined, nowMs: number): number | undefined {
  if (errorMessage === undefined) {
    return undefined;
  }
  const match = RESET_TEXT_PATTERN.exec(errorMessage);
  if (match === null) {
    return undefined;
  }
  const month = Number(match[1]!) - 1;
  const day = Number(match[2]!);
  const hour = Number(match[3]!);
  const minute = Number(match[4]!);
  const second = Number(match[5]!);
  // Range gate: Date.UTC silently NORMALIZES overflow (99-99 becomes a valid
  // future date), so out-of-range digits must be treated as unparseable.
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  const year = new Date(nowMs).getUTCFullYear();
  let instant = Date.UTC(year, month, day, hour, minute, second);
  if (instant <= nowMs) {
    instant = Date.UTC(year + 1, month, day, hour, minute, second);
  }
  return instant;
}

/**
 * Status-first outcome mapping (§Qwen Plan Probe): 2xx → available; 429 →
 * exhausted (reset instant when the surfaced text parses); 401/403 →
 * key-rejected; anything else → `undefined` — the tick then omits plan
 * status for that cycle and leaves the cache untouched.
 */
export function mapProbeOutcome(status: number, errorMessage: string | undefined, nowMs: number): PlanInfo | undefined {
  if (status >= 200 && status < 300) {
    return { status: 'available' };
  }
  if (status === 429) {
    const resetAt = parseResetInstant(errorMessage, nowMs);
    return resetAt === undefined ? { status: 'exhausted' } : { status: 'exhausted', resetAt };
  }
  if (status === 401 || status === 403) {
    return { status: 'key-rejected' };
  }
  return undefined;
}
