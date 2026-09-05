// Provider registry (provider-framework spec §Provider Registration, AD-6).
//
// A plain insertion-ordered Map with fail-fast semantics: duplicate ids are
// rejected at registration time and unknown ids at lookup time — exactly the two
// spec scenarios. No DI container.
//
// NOTE (task 2.2 / AD-1): `createDefaultRegistry()` intentionally does NOT live
// here — it lives in `src/providers/index.ts`. This module must stay free of
// provider implementations so the core never depends on concrete providers.
import type { Provider, ProviderId } from './provider';

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, Provider>();

  /** Registers a provider; throws on a duplicate id (spec: duplicate id rejected). */
  register(provider: Provider): this {
    if (this.providers.has(provider.id)) {
      throw new Error(`Duplicate provider id: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  /** Looks a provider up by id; throws on an unknown id (spec: unknown id rejected). */
  get(id: ProviderId): Provider {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      throw new Error(`Unknown provider id: ${id}`);
    }
    return provider;
  }

  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  /** Registration order — the engine refreshes in this order, making "last result wins" deterministic. */
  ids(): readonly ProviderId[] {
    return [...this.providers.keys()];
  }
}
