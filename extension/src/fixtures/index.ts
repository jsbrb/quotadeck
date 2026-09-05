// Bundled recorded fixtures (AD-8): imported here so esbuild's json loader
// inlines them into the worker bundle and FixtureTransport can serve them in
// the unpacked worker without shipping loose files. Keys follow the recorded
// naming convention `{provider}/{endpoint}--{case}`.
//
// NOTE on failure fixtures: ZAI reports failures in the HTTP-200 body (`code`
// "200" as a string, or a non-200 code), so every recorded response below is
// status 200 — providers decide success from the body, never the HTTP status.
import type { TransportResponse } from '../network/transport';
import kimiOk from './kimi/users-me-balance--ok.json';
import openaiPage1 from './openai/costs--page-1.json';
import openaiPage2Final from './openai/costs--page-2-final.json';
import qwenOk from './qwen/query-account-balance--ok.json';
import zaiCode500 from './zai/expense-bill-list--code-500.json';
import zaiCodeString200 from './zai/expense-bill-list--code-string-200.json';
import zaiPage1 from './zai/expense-bill-list--page-1.json';
import zaiPage2 from './zai/expense-bill-list--page-2.json';
import zaiPage3 from './zai/expense-bill-list--page-3.json';

const responses = {
  'zai/expense-bill-list--page-1': { status: 200, body: zaiPage1 },
  'zai/expense-bill-list--page-2': { status: 200, body: zaiPage2 },
  'zai/expense-bill-list--page-3': { status: 200, body: zaiPage3 },
  'zai/expense-bill-list--code-string-200': { status: 200, body: zaiCodeString200 },
  'zai/expense-bill-list--code-500': { status: 200, body: zaiCode500 },
  'qwen/query-account-balance--ok': { status: 200, body: qwenOk },
  'openai/costs--page-1': { status: 200, body: openaiPage1 },
  'openai/costs--page-2-final': { status: 200, body: openaiPage2Final },
  'kimi/users-me-balance--ok': { status: 200, body: kimiOk },
} satisfies Readonly<Record<string, TransportResponse>>;

export type FixtureKey = keyof typeof responses;

/** Recorded fixtures as TransportResponses, ready for FixtureTransport routing. */
export const FIXTURE_RESPONSES: Readonly<Record<FixtureKey, TransportResponse>> = responses;
