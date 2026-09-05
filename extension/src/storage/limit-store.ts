// Tier-limit override store (AD-20): reads the OPTIONAL `qd:tier-limits` key
// from the injected `chrome.storage.local` area. The stored value overrides
// the code defaults (`DEFAULT_TIER_LIMITS`); an absent or invalid shape falls
// back to the defaults so a hand-edited storage area can never break the
// budget fold. Read-only by design — no settings UI writes this key this
// milestone; the merge over the defaults happens in core/tier-budget.
import { DEFAULT_TIER_LIMITS } from '../core/tier-budget';
import type { StorageArea } from './key-store';

/** Storage key for the tier-limit override map. */
export const TIER_LIMITS_STORAGE_KEY = 'qd:tier-limits';

/** A valid override: a plain object of positive finite limits by tier name. */
function isTierLimitOverride(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  for (const limit of Object.values(value as Record<string, unknown>)) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
      return false;
    }
  }
  return true;
}

/**
 * Reads the tier-limit override; `DEFAULT_TIER_LIMITS` when the key is absent
 * or holds anything but a plain `{ [tier]: positive number }` map.
 */
export async function readTierLimits(local: StorageArea): Promise<Readonly<Record<string, number>>> {
  const value = (await local.get(TIER_LIMITS_STORAGE_KEY))[TIER_LIMITS_STORAGE_KEY];
  return isTierLimitOverride(value) ? value : DEFAULT_TIER_LIMITS;
}
