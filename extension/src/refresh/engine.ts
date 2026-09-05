// RefreshEngine (AD-2) — the single owner of the pagination loop.
//
// The engine drives any Provider through `firstRequest` → `parsePage`,
// treating the provider's `PageParse.state` as fully opaque (ZAI keeps its
// billingNo dedupe set + cursor there; OpenAI keeps its cost fold + next_page
// cursor there). Between consecutive pages it sleeps on the injected Clock
// for a duration drawn from the provider's declared `interPageDelayMs` window
// (ZAI only: [500, 2000] ms — exactly N−1 sleeps for N pages). The folded
// `NormalizedUsage` gets its `fetchedAt` stamped here from the Clock — slice-2
// providers emit 0 by contract.
//
// Error policy: a failing provider propagates its error to the CALLER —
// `refresh()` rejects, and `refreshAll()` reports it through
// `onError(providerId, error)` so the badge can render the error marker. The
// sequential `refreshAll` loop then CONTINUES with the next provider, so a
// later success in the same tick (or a later tick) replaces the marker.
import type { Clock } from '../core/clock';
import type { Provider, ProviderId, UsageQuery } from '../core/provider';
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
  /** Time source for inter-page sleeps and the `fetchedAt` stamp. */
  readonly clock: Clock;
  /** Jitter draw inside a provider's [min, max] window. Defaults to Math.random. */
  readonly rng?: () => number;
}

/** Per-result callbacks `refreshAll` reports in registry order. */
export interface RefreshCallbacks {
  /** Called after each successful provider refresh — "last result wins". */
  onUsage(usage: NormalizedUsage): void | Promise<void>;
  /** Called when a keyed provider's refresh failed; the next success replaces it. */
  onError(providerId: ProviderId, error: unknown): void | Promise<void>;
}

export class RefreshEngine {
  private readonly rng: () => number;

  constructor(private readonly deps: RefreshEngineDeps) {
    this.rng = deps.rng ?? Math.random;
  }

  /**
   * Runs ONE provider's full pagination cycle to the folded result. Throws on
   * any failure (invalid query, allowlist rejection, transport error, parse
   * error) — the caller renders the error marker.
   */
  async refresh(provider: Provider, query: UsageQuery, credential: string): Promise<NormalizedUsage> {
    let parse = provider.parsePage(
      (await this.deps.client.send(provider.id, provider.firstRequest(query), credential)).body,
      null,
    );
    while (!parse.done) {
      await this.sleepBetweenPages(provider);
      parse = provider.parsePage(
        (await this.deps.client.send(provider.id, parse.next, credential)).body,
        parse.state,
      );
    }
    // Providers emit fetchedAt 0; the engine owns the fold-time stamp (AD-1).
    return { ...parse.usage, fetchedAt: this.deps.clock.now() };
  }

  /**
   * Refreshes every provider that has a stored key, sequentially in registry
   * order, reporting each outcome through `callbacks`. Providers without a
   * stored key are skipped silently; a failing provider does not abort the
   * remaining ones.
   */
  async refreshAll(query: UsageQuery, callbacks: RefreshCallbacks): Promise<void> {
    for (const id of this.deps.registry.ids()) {
      const credential = await this.deps.keys.readKey(id);
      if (credential === undefined) {
        continue;
      }
      try {
        const usage = await this.refresh(this.deps.registry.get(id), query, credential);
        await callbacks.onUsage(usage);
      } catch (error) {
        await callbacks.onError(id, error);
      }
    }
  }

  /** Draws the inter-page delay from the provider's declared window, if any. */
  private async sleepBetweenPages(provider: Provider): Promise<void> {
    const delay = provider.interPageDelayMs;
    if (delay === undefined) {
      return;
    }
    const [min, max] = delay;
    await this.deps.clock.sleep(Math.round(min + this.rng() * (max - min)));
  }
}
