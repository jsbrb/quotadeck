// Qwen site preference store (key-storage spec §Qwen Site Preference; AD-28
// mirror of storage/zai-platform-store.ts) — the NON-secret sibling of
// KeyStore over the same injected local area.
//
// Persistence contract:
// - The preference lives under `qd:pref:qwen-site` — a namespace DISTINCT
//   from the credential namespace (`qd:key:*`): it is not masked, not
//   revoked, and carries no key semantics. KeyStore semantics are wrong for a
//   preference, so this wrapper shares none of them.
// - The value is the site string, verbatim and unmasked.
// - Reads validate: an absent OR invalid stored value reads as the default
//   `'international'` (no write-on-read, no error). Writes validate BEFORE
//   persisting, so garbage never lands in storage.
// - Local-only by construction: the injected area is `storage.local`; this
//   wrapper has no sync path, matching the KeyStore pattern.
import { isQwenSite, type QwenSite } from '../core/qwen-sites';
import type { StorageArea } from './key-store';

/** Storage key for the Qwen BSS site preference. */
export const QWEN_SITE_STORAGE_KEY = 'qd:pref:qwen-site';

/** The default site when no (valid) preference is stored (spec §Qwen Parsing). */
export const DEFAULT_QWEN_SITE: QwenSite = 'international';

/** Reads the site preference; absent or invalid values default to `'international'`. */
export async function readQwenSite(local: StorageArea): Promise<QwenSite> {
  const value = (await local.get(QWEN_SITE_STORAGE_KEY))[QWEN_SITE_STORAGE_KEY];
  return isQwenSite(value) ? value : DEFAULT_QWEN_SITE;
}

/** Persists the site preference; refuses a value outside the union. */
export async function writeQwenSite(local: StorageArea, site: QwenSite): Promise<void> {
  if (!isQwenSite(site)) {
    throw new Error(`Invalid Qwen site: ${String(site)} (expected 'international' or 'china')`);
  }
  await local.set({ [QWEN_SITE_STORAGE_KEY]: site });
}
