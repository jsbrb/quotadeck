// KeyStore (key-storage spec) — the ONLY home for provider key material.
//
// Persistence contract (spec §Local-Only Persistence):
// - Credentials live exclusively in the injected `chrome.storage.local` area
//   under `qd:key:{providerId}`. This wrapper NEVER touches `chrome.storage.sync`
//   — the type below is injected by the caller and this module has no `.sync`
//   path at all — and key material is NEVER written anywhere outside this
//   wrapper, including `localStorage` (which the extension never uses for keys).
// - Display reads go through `readMaskedCredential`, which masks every secret
//   part independently and never reveals a full credential.
// - `revokeCredential` removes the stored credential; afterwards reads report
//   absence and no credential can be attached to provider activity.
//
// The area is injected (AD-1): in production `platform/browser-api.ts` passes
// `chrome.storage.local`; tests pass the in-memory fake from src/testing/.
import type { Credential, CredentialType, ProviderId } from '../core/provider';

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

/** Masked display form of a credential: every secret part masked independently. */
export type MaskedCredential =
  | { readonly type: 'bearer' | 'openai-admin-read'; readonly maskedToken: string }
  | { readonly type: 'ak-sk'; readonly maskedAccessKeyId: string; readonly maskedAccessKeySecret: string };

/** Stored shape of a qwen AK/SK pair: one JSON object, both parts, one key. */
interface StoredPair {
  readonly accessKeyId: string;
  readonly accessKeySecret: string;
}

function isStoredPair(value: unknown): value is StoredPair {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const pair = value as Record<string, unknown>;
  return typeof pair.accessKeyId === 'string' && typeof pair.accessKeySecret === 'string';
}

export class KeyStore {
  constructor(private readonly local: StorageArea) {}

  private storageKey(providerId: ProviderId): string {
    return `${KEY_STORAGE_PREFIX}${providerId}`;
  }

  /** Persists a typed credential; refuses empty token or empty pair parts. */
  async saveCredential(providerId: ProviderId, credential: Credential): Promise<void> {
    const empty = credential.type === 'ak-sk'
      ? credential.accessKeyId.length === 0 || credential.accessKeySecret.length === 0
      : credential.token.length === 0;
    if (empty) {
      throw new Error(`Refusing to store an empty credential for provider ${providerId}`);
    }
    const value = credential.type === 'ak-sk'
      ? { accessKeyId: credential.accessKeyId, accessKeySecret: credential.accessKeySecret }
      : credential.token;
    await this.local.set({ [this.storageKey(providerId)]: value });
  }

  /**
   * Type-aware read for the authentication path. A legacy plain string under
   * `qd:key:qwen` (hito-2) is NOT a pair — it reads as `undefined` and the
   * user re-enters the credential; no unparseable value reaches the signer.
   */
  async readCredential(providerId: ProviderId, type: CredentialType): Promise<Credential | undefined> {
    const key = this.storageKey(providerId);
    const value = (await this.local.get(key))[key];
    if (type === 'ak-sk') {
      return isStoredPair(value)
        ? { type: 'ak-sk', accessKeyId: value.accessKeyId, accessKeySecret: value.accessKeySecret }
        : undefined;
    }
    return typeof value === 'string' ? { type, token: value } : undefined;
  }

  /**
   * Masked display read over the Credential union: each secret part is masked
   * independently (`••••` + at most 4 trailing characters, MASK_SUFFIX_LENGTH);
   * the full pair is never exposed through any display path.
   */
  async readMaskedCredential(providerId: ProviderId, type: CredentialType): Promise<MaskedCredential | undefined> {
    const credential = await this.readCredential(providerId, type);
    if (credential === undefined) {
      return undefined;
    }
    return credential.type === 'ak-sk'
      ? {
          type: 'ak-sk',
          maskedAccessKeyId: mask(credential.accessKeyId),
          maskedAccessKeySecret: mask(credential.accessKeySecret),
        }
      : { type: credential.type, maskedToken: mask(credential.token) };
  }

  /** Removes the stored credential — for a pair, both parts atomically. */
  async revokeCredential(providerId: ProviderId): Promise<void> {
    await this.local.remove(this.storageKey(providerId));
  }
}
