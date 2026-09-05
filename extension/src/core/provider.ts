// Provider contract (provider-framework spec §Provider Contract).
//
// A Provider models ONE vendor's usage/balance endpoint as a parse pipeline over
// recorded pages. Providers never perform I/O: they translate a UsageQuery into a
// ProviderRequest (before any dispatch) and parse response bodies into normalized
// usage. All network access belongs to the network layer; all scheduling belongs to
// the refresh engine.
import type { ProviderRequest } from '../network/request';
import type { NormalizedUsage } from './usage';

/** Stable provider identifiers. Also the registry key and the allowlist scope. */
export type ProviderId = 'zai' | 'qwen' | 'openai' | 'kimi';

/**
 * Credential shapes the four vendors accept:
 * - `bearer` — ZAI and Kimi API tokens (`Authorization: Bearer <key>`).
 * - `ak-sk` — Alibaba Cloud AccessKeyId/AccessKeySecret (Qwen via BSS; DashScope
 *   `sk-` keys are rejected — see core/credentials.ts).
 * - `openai-admin-read` — OpenAI admin key with read scope (`sk-admin-...`).
 */
export type CredentialType = 'bearer' | 'ak-sk' | 'openai-admin-read';

/**
 * A concrete credential as stored and attached (AD-17). Token credentials
 * travel exclusively as the `Authorization` header value; the ak-sk pair
 * feeds the BSS RPC signer — the secret never leaves the signing boundary.
 */
export type Credential =
  | { readonly type: 'bearer' | 'openai-admin-read'; readonly token: string }
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
 * Provider-agnostic refresh query. Fields are optional because providers consume
 * different subsets; each provider validates the fields it requires inside
 * `firstRequest` — invalid parameters throw BEFORE any request is dispatched
 * (provider-framework spec §OpenAI Request Validation).
 */
export interface UsageQuery {
  /** Billing months for month-scoped endpoints (ZAI): `YYYY-MM`, oldest first (AD-23). */
  readonly billingMonths?: readonly string[];
  /** Inclusive range start for cost-window endpoints (OpenAI), epoch seconds. */
  readonly startTime?: number;
  /** Exclusive range end for cost-window endpoints (OpenAI), epoch seconds. */
  readonly endTime?: number;
  /** Refresh instant from the injected Clock, epoch ms — anchors ZAI's 5h window. */
  readonly now?: number;
  /** Tier-limit overrides over the defaults (ZAI; AD-20); absent → defaults. */
  readonly tierLimits?: Readonly<Record<string, number>>;
}

/**
 * Opaque pagination state owned by the provider, threaded by the engine across
 * pages (AD-2). The engine never inspects its contents — ZAI keeps its `billingNo`
 * dedupe set, billing-months queue and page cursor here; OpenAI keeps its
 * accumulated cost plus `next_page` cursor here.
 */
export type ProviderState = Readonly<Record<string, unknown>>;

/**
 * Result of parsing one response page:
 * - `done: true` — the refresh completes and emits the folded usage result.
 * - `done: false` — another page is required; `next` is dispatched after the
 *   provider's inter-page delay.
 */
export type PageParse =
  | { readonly done: true; readonly usage: NormalizedUsage }
  | { readonly done: false; readonly state: ProviderState; readonly next: ProviderRequest };

/** Contract every provider implements (provider-framework spec). */
export interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly credentialType: CredentialType;
  /**
   * Delay window between consecutive pages, `[min, max]` ms. Declared only by
   * providers whose endpoint documents a politeness window (ZAI: [500, 2000]).
   * The engine draws the actual duration from the injected Clock (AD-2).
   */
  readonly interPageDelayMs?: readonly [min: number, max: number];
  /** Builds the first request; MUST throw on invalid query parameters (no dispatch happens then). */
  firstRequest(query: UsageQuery): ProviderRequest;
  /**
   * Parses one response body. MUST throw an explicit error on a non-success
   * payload (e.g. ZAI non-numeric or non-200 `code`).
   */
  parsePage(body: unknown, state: ProviderState | null): PageParse;
}
