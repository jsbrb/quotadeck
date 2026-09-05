// KeyStore (key-storage spec) — the ONLY home for provider key material.
//
// Persistence contract (spec §Local-Only Persistence):
// - Keys live exclusively in the injected `chrome.storage.local` area under
//   `qd:key:{providerId}`. This wrapper NEVER touches `chrome.storage.sync` —
//   the type below is injected by the caller and this module has no `.sync`
//   path at all — and key material is NEVER written anywhere outside this
//   wrapper, including `localStorage` (which the extension never uses for keys).
// - Display reads go through `readMaskedKey`, which reveals at most the last
//   4 characters and never the full key.
// - `revokeKey` removes the stored key; afterwards reads report absence and no
//   credential can be attached to provider activity.
//
// The area is injected (AD-1): in production `platform/browser-api.ts` passes
// `chrome.storage.local`; tests pass the in-memory fake from src/testing/.
import type { ProviderId } from '../core/provider';

/**
 * Minimal structural port over a `chrome.storage` area (promise-based, MV3
 * style). `platform/browser-api.ts` adapts the real `chrome.storage.local` to
 * this shape; `FakeStorageArea` in src/testing/fake-browser.ts implements it.
 */
export interface StorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** Storage namespace for provider credentials: `qd:key:{providerId}`. */
export const KEY_STORAGE_PREFIX = 'qd:key:';

/** Reveals at most this many trailing characters on the display path. */
export const MASK_SUFFIX_LENGTH = 4;

function mask(credential: string): string {
  // A key of length <= 4 would be fully revealed by any suffix: show nothing.
  if (credential.length <= MASK_SUFFIX_LENGTH) {
    return '••••';
  }
  return `••••${credential.slice(-MASK_SUFFIX_LENGTH)}`;
}

export class KeyStore {
  constructor(private readonly local: StorageArea) {}

  private storageKey(providerId: ProviderId): string {
    return `${KEY_STORAGE_PREFIX}${providerId}`;
  }

  /** Persists a provider key; refuses to store an empty credential. */
  async saveKey(providerId: ProviderId, credential: string): Promise<void> {
    if (credential.length === 0) {
      throw new Error(`Refusing to store an empty credential for provider ${providerId}`);
    }
    await this.local.set({ [this.storageKey(providerId)]: credential });
  }

  /** Full-key read for the authentication path. `undefined` = no stored key. */
  async readKey(providerId: ProviderId): Promise<string | undefined> {
    const key = this.storageKey(providerId);
    const items = await this.local.get(key);
    const value = items[key];
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * Masked read for display: reveals at most the last 4 characters and never
   * the full key (spec §Masked Display). `undefined` = no stored key.
   */
  async readMaskedKey(providerId: ProviderId): Promise<string | undefined> {
    const credential = await this.readKey(providerId);
    return credential === undefined ? undefined : mask(credential);
  }

  /** Removes the stored key; subsequent reads report absence. */
  async revokeKey(providerId: ProviderId): Promise<void> {
    await this.local.remove(this.storageKey(providerId));
  }
}
