// RefreshEngine (AD-2) — the single owner of the pagination loop.
//
// The engine drives any Provider through `firstRequest` → `parsePage`,
// treating the provider's `PageParse.state` as fully opaque (OpenAI keeps its
// cost fold + next_page cursor there; the single-shot ZAI monitor provider
// keeps none). HitO-4 removed the inter-page sleep machinery: no provider
// declares a politeness window anymore, so `next` requests dispatch back to
// back. The folded `NormalizedUsage` gets its `fetchedAt` stamped here from
// the Clock — providers emit 0 by contract.
//
// Error policy: a failing provider propagates its error to the CALLER —
// `refresh()` rejects, and `refreshAll()` reports it through
// `onError(providerId, error)` so the badge can render the error marker. The
// sequential `refreshAll` loop then CONTINUES with the next provider, so a
// later success in the same tick (or a later tick) replaces the marker.
import type { Clock } from '../core/clock';
import type { Credential, Provider, ProviderId, UsageQuery } from '../core/provider';
import type { ProviderRegistry } from '../core/registry';
import type { NormalizedUsage } from '../core/usage';
import type { AllowlistNetworkClient } from '../network/client';
import type { KeyStore } from '../storage/key-store';

export interface RefreshEngineDeps {
  /** Registry whose registration order defines the refresh (and badge) order. */
  readonly registry: ProviderRegistry;
  /** Allowlist-enforcing client — the engine never touches a Transport directly. */
  readonly client: AllowlistNetworkClient;
  /** Stored credentials; providers without a key are skipped by `refreshAll`. */
  readonly keys: KeyStore;
  /** Time source for the `fetchedAt` stamp. */
  readonly clock: Clock;
}

/** Per-result callbacks `refreshAll` reports in registry order. */
export interface RefreshCallbacks {
  /** Called after each successful provider refresh — "last result wins". */
  onUsage(usage: NormalizedUsage): void | Promise<void>;
  /** Called when a keyed provider's refresh failed; the next success replaces it. */
  onError(providerId: ProviderId, error: unknown): void | Promise<void>;
}

export class RefreshEngine {
  constructor(private readonly deps: RefreshEngineDeps) {}

  /**
   * Runs ONE provider's full pagination cycle to the folded result. Throws on
   * any failure (invalid query, allowlist rejection, transport error, parse
   * error) — the caller renders the error marker. The credential is threaded
   * to every dispatch untouched; only the network client attaches it.
   */
  async refresh(provider: Provider, query: UsageQuery, credential: Credential): Promise<NormalizedUsage> {
    let parse = provider.parsePage(
      (await this.deps.client.send(provider.id, provider.firstRequest(query), credential)).body,
      null,
    );
    while (!parse.done) {
      parse = provider.parsePage(
        (await this.deps.client.send(provider.id, parse.next, credential)).body,
        parse.state,
      );
    }
    // Providers emit fetchedAt 0; the engine owns the fold-time stamp (AD-1).
    return { ...parse.usage, fetchedAt: this.deps.clock.now() };
  }

  /**
   * Refreshes every provider that has a stored credential, sequentially in
   * registry order, reporting each outcome through `callbacks`. Credentials
   * are read type-aware (`readCredential(id, provider.credentialType)`) — a
   * qwen legacy plain string reads as no credential, so that provider is
   * skipped; failures do not abort the remaining ones.
   */
  async refreshAll(query: UsageQuery, callbacks: RefreshCallbacks): Promise<void> {
    for (const id of this.deps.registry.ids()) {
      const provider = this.deps.registry.get(id);
      const credential = await this.deps.keys.readCredential(id, provider.credentialType);
      if (credential === undefined) {
        continue;
      }
      try {
        const usage = await this.refresh(provider, query, credential);
        await callbacks.onUsage(usage);
      } catch (error) {
        await callbacks.onError(id, error);
      }
    }
  }
}
