// Provider contract (provider-framework spec §Provider Contract).
//
// A Provider models ONE vendor's usage/balance endpoint as a parse pipeline over
// recorded pages. Providers never perform I/O: they translate a UsageQuery into a
// ProviderRequest (before any dispatch) and parse response bodies into normalized
// usage. All network access belongs to the network layer; all scheduling belongs to
// the refresh engine.
import type { ProviderRequest } from '../network/request';
import type { NormalizedUsage } from './usage';
import type { QwenSite } from './qwen-sites';
import type { ZaiPlatform } from './zai-platforms';

/**
 * Stable provider identifiers. Also the registry key and the allowlist scope.
 * `deepseek` (hito-13) is PAY-AS-YOU-GO: no coding plan exists, so usage is
 * the pre-paid wallet on `GET /user/balance` — figures are derived into
 * `NormalizedUsage.wallet` (no reset countdowns, no days-remaining).
 */
export type ProviderId = 'zai' | 'qwen' | 'openai' | 'kimi' | 'deepseek';

/**
 * Credential shapes the four vendors accept:
 * - `bearer` — Kimi API tokens and DeepSeek API keys (`Authorization: Bearer <key>`).
 * - `ak-sk` — Alibaba Cloud AccessKeyId/AccessKeySecret (Qwen via BSS; DashScope
 *   `sk-` keys are rejected — see core/credentials.ts).
 * - `openai-admin-read` — OpenAI admin key with read scope (`sk-admin-...`).
 * - `raw` — ZAI monitor key, attached verbatim (`Authorization: <key>`, no
 *   Bearer prefix) on the ZAI monitor hosts only (AD-25).
 * - `qwen-plan` — the auxiliary Qwen token-plan key (`sk-sp-`), attached as
 *   Bearer ONLY on the token-plan probe host (hito-8 dual credential: it
 *   rides the token union so the client's Bearer branch covers it — no new
 *   attach mode).
 */
export type CredentialType = 'bearer' | 'ak-sk' | 'openai-admin-read' | 'raw' | 'qwen-plan';

/**
 * A concrete credential as stored and attached (AD-17). Token credentials
 * travel exclusively as the `Authorization` header value; the ak-sk pair
 * feeds the BSS RPC signer — the secret never leaves the signing boundary.
 */
export type Credential =
  | { readonly type: 'bearer' | 'openai-admin-read' | 'raw' | 'qwen-plan'; readonly token: string }
  | { readonly type: 'ak-sk'; readonly accessKeyId: string; readonly accessKeySecret: string };

/**
 * Body-level API failure (AD-21): the provider payload answered non-success
 * even though the transport succeeded (e.g. ZAI numeric `code !== 200`).
 * Classifies as `server` in the refresh taxonomy.
 */
export class ProviderApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderApiError';
  }
}

/**
 * Provider-agnostic refresh query (provider-framework spec §Provider
 * Contract). Fields are optional because providers consume different
 * subsets; each provider validates the fields it requires inside
 * `firstRequest` — invalid parameters throw BEFORE any request is dispatched
 * (provider-framework spec §OpenAI Request Validation). The query MUST NOT
 * carry tier limits or billing months — hito-4 retired both feeds.
 */
export interface UsageQuery {
  /** ZAI monitor platform selection; absent → `'zai'` (AD-28). */
  readonly zaiPlatform?: ZaiPlatform;
  /** Qwen BSS site selection; absent → `'international'` (AD-28 mirror). */
  readonly qwenSite?: QwenSite;
  /** Inclusive range start for cost-window endpoints (OpenAI), epoch seconds. */
  readonly startTime?: number;
  /** Exclusive range end for cost-window endpoints (OpenAI), epoch seconds. */
  readonly endTime?: number;
  /** Refresh instant from the injected Clock, epoch ms — engine/fetchedAt symmetry. */
  readonly now?: number;
}

/**
 * Opaque pagination state owned by the provider, threaded by the engine across
 * pages (AD-2). The engine never inspects its contents — OpenAI keeps its
 * accumulated cost plus `next_page` cursor here; the single-shot ZAI monitor
 * provider keeps none.
 */
export type ProviderState = Readonly<Record<string, unknown>>;

/**
 * Result of parsing one response page:
 * - `done: true` — the refresh completes and emits the folded usage result.
 * - `done: false` — another page is required; `next` is dispatched next.
 */
export type PageParse =
  | { readonly done: true; readonly usage: NormalizedUsage }
  | { readonly done: false; readonly state: ProviderState; readonly next: ProviderRequest };

/** Contract every provider implements (provider-framework spec). */
export interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;
  /** The attach-mode declaration (AD-25): how the client attaches the credential. */
  readonly credentialType: CredentialType;
  /** Builds the first request; MUST throw on invalid query parameters (no dispatch happens then). */
  firstRequest(query: UsageQuery): ProviderRequest;
  /**
   * Parses one response body. MUST throw an explicit error on a non-success
   * payload (e.g. ZAI non-numeric or non-200 `code`).
   */
  parsePage(body: unknown, state: ProviderState | null): PageParse;
}
