// Qwen token-plan quota parse (hito-12; evidence: docs/spike/endpoints.md
// §Qwen token-plan quota — session-token surface — discovered-live, the
// 2026-10-25 maintainer live capture).
//
// PURE module — no fetch, no token material. Dispatch and the console access
// token belong to the background composition; this file only folds the
// gateway response envelope into the repo's UsageWindow shape.
//
// Envelope validation is STATUS-FIRST: the payload lives at
// `data.DataV2.data.data`, and success requires the gateway `code` to be 200
// or "200" (the per-site tolerance qwen.ts applies to BSS envelopes) AND the
// inner `success: true` AND `failed: false`. Any non-success throws
// ProviderApiError (classifies as `server` per AD-21); a successful envelope
// with a missing or garbage payload answers with honest absent fields, never
// a crash.
//
// Semantics (COMPLETE surface — exactly two fields): `per1MonthPercentage` is
// a 0..1 USED fraction mapped to the 0-100 window convention (× 100) and
// passed through UNCAPPED (a server 1.5 stays 150); non-finite or absent →
// percentage absent. `per1MonthResetTime` finite → carried VERBATIM as
// resetAt (the countdown renders from it at display time). used, total and
// remaining NEVER exist on this surface and are never synthesized — only
// percentage and resetAt are ever set on the returned UsageWindow.
import { ProviderApiError } from '../core/provider';
import type { UsageWindow } from '../core/usage';
import { asObject } from './parse-utils';

/** Finite-number gate: anything else (null, absent, NaN, string) is absent. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Renders a missing/typed value for error messages (qwen.ts/zai.ts style). */
function describeValue(value: unknown): string {
  return value === undefined ? 'no value' : `${typeof value} ${JSON.stringify(value)}`;
}

/**
 * Parses the token-plan usage body into a UsageWindow carrying at most
 * `percentage` (0-100 convention, UNCAPPED) and `resetAt` (epoch ms verbatim).
 */
export function parseTokenPlanUsage(body: unknown): UsageWindow {
  const root = asObject(body);
  const code = root?.code;
  if (code !== 200 && code !== '200') {
    throw new ProviderApiError(
      `Qwen token-plan usage failed: gateway code must be 200 or "200", got ${describeValue(code)}.`,
    );
  }
  const data = asObject(root?.data);
  const dataV2 = asObject(data?.DataV2);
  const inner = asObject(dataV2?.data);
  const success = inner?.success;
  if (success !== true) {
    throw new ProviderApiError(
      `Qwen token-plan usage failed: inner success must be true, got ${describeValue(success)}.`,
    );
  }
  const failed = inner?.failed;
  if (failed !== false) {
    throw new ProviderApiError(
      `Qwen token-plan usage failed: inner failed must be false, got ${describeValue(failed)}.`,
    );
  }
  // A successful envelope with a missing/garbage payload reports honestly:
  // asObject(null) fallback → both fields absent, no crash.
  const payload = asObject(inner?.data) ?? {};
  const fraction = finiteNumber(payload.per1MonthPercentage);
  const resetAt = finiteNumber(payload.per1MonthResetTime);
  return {
    ...(fraction !== undefined ? { percentage: fraction * 100 } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
  };
}

