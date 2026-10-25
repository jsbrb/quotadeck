// QwenQuotaStep (hito-12 WU-C2) — the tick-level two-hop quota composition,
// sibling of QwenPlanStep (§Qwen Plan Probe Cadence discipline) and
// deliberately OUTSIDE RefreshEngine.refresh: the engine is
// single-credential-per-provider by design, while this flow consumes TWO
// credential roles — the stored AK/SK signs the mint (the client's acs3 seam,
// hito-12 B2), and the minted console token is TRANSIENT, riding only the
// session marker (hito-12 C1).
//
// Contract (parent-ratified design; live evidence docs/spike/endpoints.md
// §Qwen token-plan quota — session-token surface):
// - Runs every tick when a qwen AK/SK is stored AND the site is
//   'international'. China has no live-verified quota surface — the builders
//   answer null and the step no-ops; a missing pair no-ops without dispatch.
//   NO TTL cache: two live calls proved near-real-time freshness, and the
//   hop pair costs a mint plus a read-only gateway call — no paid inference.
// - The minted session token lives ONLY in a local variable for the tick:
//   never stored, never an instance field across ticks, never logged. The
//   gateway auth-failure line names the STATUS ONLY — the transport embeds
//   bounded body snippets, and a hostile echo must never reach the console.
// - Every failure class answers with exactly ONE console.error line prefixed
//   '[quotadeck] qwen quota' and omits the quota — the tick NEVER throws.
// - Both quota fields absent is no-data: logged and omitted — an empty quota
//   object never rides the snapshot.
import { ProviderApiError } from '../core/provider';
import type { Credential } from '../core/provider';
import type { QwenSite } from '../core/qwen-sites';
import type { TokenPlanQuota, UsageWindow } from '../core/usage';
import type { AllowlistNetworkClient } from '../network/client';
import { HttpStatusError } from '../network/fetch-transport';
import { NetworkRejectionError } from '../network/request';
import {
  mintQuotaTokenRequest,
  parseMintResponse,
  parseTokenPlanUsage,
  tokenPlanUsageRequest,
} from '../providers/qwen-token-plan';
import type { KeyStore } from '../storage/key-store';

export interface QwenQuotaStepDeps {
  /** Allowlist-enforcing client — the flow never touches a Transport directly. */
  readonly client: AllowlistNetworkClient;
  /** Stored credentials; the mint hop consumes the `qwen` AK/SK pair. */
  readonly keys: KeyStore;
}

/** Probe-parity error rendering for the log suffix (name + message only). */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export class QwenQuotaStep {
  constructor(private readonly deps: QwenQuotaStepDeps) {}

  /**
   * Runs the two-hop flow for one tick. `nowMs` comes from the caller's
   * injected clock (AD-1: quota.fetchedAt); `site` is the tick's stored
   * preference — anything but the live-verified 'international' no-ops.
   */
  async resolve(nowMs: number, site: QwenSite): Promise<TokenPlanQuota | undefined> {
    const mintRequest = mintQuotaTokenRequest(site);
    if (mintRequest === null) {
      return undefined; // china: no live-verified surface — no dispatch, no guess
    }
    const credential = await this.deps.keys.readCredential('qwen', 'ak-sk');
    if (credential === undefined || credential.type !== 'ak-sk') {
      return undefined; // no stored pair: nothing to mint with (legacy strings read undefined)
    }
    let sessionToken: string;
    try {
      const mintResponse = await this.deps.client.send('qwen', mintRequest, credential);
      sessionToken = parseMintResponse(mintResponse.body);
    } catch (error) {
      // Rejections at the mint seam (local guard or vendor 401/403 — e.g. the
      // NoPermission RAM-policy miss) get their own class line; everything
      // else is a plain mint failure. Neither ever carries a token: nothing
      // exists to carry yet, and parseMintError surfaces only Code/Message.
      if (
        error instanceof NetworkRejectionError ||
        (error instanceof HttpStatusError && (error.status === 401 || error.status === 403))
      ) {
        console.error('[quotadeck] qwen quota mint rejected (NoPermission/auth):', describeError(error));
      } else {
        console.error('[quotadeck] qwen quota mint failed:', describeError(error));
      }
      return undefined;
    }
    // The token exists ONLY as this local from here; readUsage consumes it and
    // it dies with the frame — no field, no store, no cache across ticks.
    const window = await this.readUsage(sessionToken, site, credential);
    if (window === undefined) {
      return undefined;
    }
    if (window.percentage === undefined && window.resetAt === undefined) {
      console.error('[quotadeck] qwen quota gateway answered no data — quota omitted.');
      return undefined;
    }
    return {
      ...(window.percentage !== undefined ? { percentage: window.percentage } : {}),
      ...(window.resetAt !== undefined ? { resetAt: window.resetAt } : {}),
      fetchedAt: nowMs,
    };
  }

  /**
   * Hop 2 — dispatch the session-marked gateway request and fold the body
   * through the EXISTING T3 parse (uncapped percentage, verbatim resetAt).
   * Each failure class logs one line and returns undefined; the
   * auth-failure line names the status only (never the transport's body
   * snippet).
   */
  private async readUsage(
    sessionToken: string,
    site: QwenSite,
    credential: Extract<Credential, { type: 'ak-sk' }>,
  ): Promise<UsageWindow | undefined> {
    const request = tokenPlanUsageRequest(sessionToken, site);
    if (request === null) {
      return undefined; // unreachable behind the resolve() site gate; kept explicit
    }
    try {
      const response = await this.deps.client.send('qwen', request, credential);
      return parseTokenPlanUsage(response.body);
    } catch (error) {
      if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) {
        console.error(
          `[quotadeck] qwen quota gateway auth failed (re-auth needed): HTTP ${error.status}`,
        );
      } else if (error instanceof ProviderApiError) {
        console.error('[quotadeck] qwen quota gateway body failed:', describeError(error));
      } else {
        console.error('[quotadeck] qwen quota gateway request failed:', describeError(error));
      }
      return undefined;
    }
  }
}
