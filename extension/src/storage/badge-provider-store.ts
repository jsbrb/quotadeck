// Badge provider preference store (hito-12 WU-D2 §Badge Provider Preference;
// sibling of storage/zai-platform-store.ts and storage/qwen-site-store.ts) —
// the NON-secret wrapper over the same injected local area.
//
// Persistence contract:
// - The preference lives under `qd:pref:badge-provider` — a namespace DISTINCT
//   from the credential namespace (`qd:key:*`): it is not masked, not
//   revoked, and carries no key semantics. KeyStore semantics are wrong for a
//   preference, so this wrapper shares none of them.
// - The value is the provider id string, verbatim and unmasked.
// - Reads validate: an absent OR invalid stored value reads as the default
//   `'zai'` (no write-on-read, no error). Writes validate BEFORE persisting,
//   so garbage never lands in storage.
// - Validation is ProviderId-wide, NOT shipped-wide: the guard accepts every
//   id in PROVIDER_METADATA, so un-shipping a provider never invalidates a
//   stored preference (the badge resolution treats an unshipped choice as
//   absent at render time — background.ts).
// - Local-only by construction: the injected area is `storage.local`; this
//   wrapper has no sync path, matching the KeyStore pattern.
import type { ProviderId } from '../core/provider';
import { PROVIDER_METADATA } from '../core/provider-metadata';
import type { StorageArea } from './key-store';

/** Storage key for the badge provider preference. */
export const BADGE_PROVIDER_STORAGE_KEY = 'qd:pref:badge-provider';

/** The default provider when no (valid) preference is stored. */
export const DEFAULT_BADGE_PROVIDER: ProviderId = 'zai';

/**
 * Runtime guard shared by the store and the popup controller: the id reaches
 * production code through storage reads and DOM select values, so an unknown
 * value must be recognizable before it is persisted or rendered.
 */
export function isBadgeProviderId(value: unknown): value is ProviderId {
  return PROVIDER_METADATA.some((metadata) => metadata.id === value);
}

/** Reads the badge provider preference; absent or invalid values default to `'zai'`. */
export async function readBadgeProvider(local: StorageArea): Promise<ProviderId> {
  const value = (await local.get(BADGE_PROVIDER_STORAGE_KEY))[BADGE_PROVIDER_STORAGE_KEY];
  return isBadgeProviderId(value) ? value : DEFAULT_BADGE_PROVIDER;
}

/** Persists the badge provider preference; refuses a value outside the known provider ids. */
export async function writeBadgeProvider(local: StorageArea, providerId: ProviderId): Promise<void> {
  if (!isBadgeProviderId(providerId)) {
    throw new Error(`Invalid badge provider: ${String(providerId)} (expected a known provider id)`);
  }
  await local.set({ [BADGE_PROVIDER_STORAGE_KEY]: providerId });
}
