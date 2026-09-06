// Bundled recorded fixtures (AD-8): imported here so esbuild's json loader
// inlines them into the worker bundle and FixtureTransport can serve them in
// the unpacked worker without shipping loose files. Keys follow the recorded
// naming convention `{provider}/{endpoint}--{case}`.
//
// NOTE on failure fixtures: the ZAI monitor API reports body-level failures
// inside an HTTP-200 envelope (`code` as a string "200", or a non-200 code),
// so those recorded responses are status 200 — providers decide success from
// the body, never the HTTP status. Plain-text transport-level failures (401)
// are recorded with their real status; classification is status-first (AD-30).
//
// O3: the ZAI monitor payload shape is pinned from a LIVE CAPTURE
// (maintainer plan "pro", api.z.ai, 2026-09-05): entries live under
// `data.limits`, `usageDetails` is an ARRAY of {modelCode, usage} entries,
// and a TOKENS_LIMIT may carry percentage + nextResetTime with NO total
// (monitor--pro-plan is the verbatim capture). Community evidence
// (zai-org/zai-coding-plugins, ecerutti/glm-usage-monitor,
// guyinwonder168/opencode-glm-quota) agrees on the field names; totals are
// kept in the synthetic fixtures (over-100, null-pct, fallback-position) so
// the used-derivation path stays covered. No test asserts live semantics
// beyond fixture-internal consistency.
import type { TransportResponse } from '../network/transport';
import kimiOk from './kimi/users-me-balance--ok.json';
import openaiPage1 from './openai/costs--page-1.json';
import openaiPage2Final from './openai/costs--page-2-final.json';
import qwenIntlOk from './qwen/query-account-balance--intl-ok.json';
import qwenOk from './qwen/query-account-balance--ok.json';
import zaiCodeString200 from './zai/monitor--code-string-200.json';
import zaiFallbackPosition from './zai/monitor--fallback-position.json';
import zaiMcpOnly from './zai/monitor--mcp-only.json';
import zaiNullPct from './zai/monitor--null-pct.json';
import zaiOver100 from './zai/monitor--over-100.json';
import zaiPlainText401 from './zai/monitor--plain-text-401.json';
import zaiProPlan from './zai/monitor--pro-plan.json';

const responses = {
  'zai/monitor--pro-plan': { status: 200, body: zaiProPlan },
  'zai/monitor--over-100': { status: 200, body: zaiOver100 },
  'zai/monitor--null-pct': { status: 200, body: zaiNullPct },
  'zai/monitor--mcp-only': { status: 200, body: zaiMcpOnly },
  'zai/monitor--fallback-position': { status: 200, body: zaiFallbackPosition },
  'zai/monitor--code-string-200': { status: 200, body: zaiCodeString200 },
  'zai/monitor--plain-text-401': { status: 401, body: zaiPlainText401 },
  'qwen/query-account-balance--ok': { status: 200, body: qwenOk },
  'qwen/query-account-balance--intl-ok': { status: 200, body: qwenIntlOk },
  'openai/costs--page-1': { status: 200, body: openaiPage1 },
  'openai/costs--page-2-final': { status: 200, body: openaiPage2Final },
  'kimi/users-me-balance--ok': { status: 200, body: kimiOk },
} satisfies Readonly<Record<string, TransportResponse>>;

export type FixtureKey = keyof typeof responses;

/** Recorded fixtures as TransportResponses, ready for FixtureTransport routing. */
export const FIXTURE_RESPONSES: Readonly<Record<FixtureKey, TransportResponse>> = responses;
