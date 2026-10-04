// ZAI platform preference store (key-storage spec §ZAI Platform Preference;
// AD-28) — the NON-secret sibling of KeyStore over the same injected local
// area.
//
// Persistence contract:
// - The preference lives under `qd:pref:zai-platform` — a namespace DISTINCT
//   from the credential namespace (`qd:key:*`): it is not masked, not
//   revoked, and carries no key semantics. KeyStore semantics are wrong for a
//   preference, so this wrapper shares none of them.
// - The value is the platform string, verbatim and unmasked.
// - Reads validate: an absent OR invalid stored value reads as the default
//   `'zai'` (no write-on-read, no error). Writes validate BEFORE persisting,
//   so garbage never lands in storage.
// - Local-only by construction: the injected area is `storage.local`; this
//   wrapper has no sync path, matching the KeyStore pattern.
import type { ZaiPlatform } from '../core/zai-platforms';
import type { StorageArea } from './key-store';

/** Storage key for the ZAI monitor platform preference. */
export const ZAI_PLATFORM_STORAGE_KEY = 'qd:pref:zai-platform';

/** The default platform when no (valid) preference is stored (spec §Platform Binding). */
export const DEFAULT_ZAI_PLATFORM: ZaiPlatform = 'zai';

function isZaiPlatform(value: unknown): value is ZaiPlatform {
  return value === 'zai' || value === 'zhipu';
}

/** Reads the platform preference; absent or invalid values default to `'zai'`. */
export async function readZaiPlatform(local: StorageArea): Promise<ZaiPlatform> {
  const value = (await local.get(ZAI_PLATFORM_STORAGE_KEY))[ZAI_PLATFORM_STORAGE_KEY];
  return isZaiPlatform(value) ? value : DEFAULT_ZAI_PLATFORM;
}

/** Persists the platform preference; refuses a value outside the union. */
export async function writeZaiPlatform(local: StorageArea, platform: ZaiPlatform): Promise<void> {
  if (!isZaiPlatform(platform)) {
    throw new Error(`Invalid ZAI platform: ${String(platform)} (expected 'zai' or 'zhipu')`);
  }
  await local.set({ [ZAI_PLATFORM_STORAGE_KEY]: platform });
}
