// SnapshotStore (popup-ui spec §Current Cycle Data on Open; AD-10/AD-12) —
// the worker-persisted, key-free cycle snapshot.
//
// Persistence contract:
// - The last completed refresh cycle's per-provider outcomes live exclusively
//   in the injected `chrome.storage.local` area under the single key
//   `qd:snapshot`. One `write` per completed cycle keeps cycle semantics
//   atomic — a reader never observes half a cycle (AD-10).
// - Error entries carry NO payload (AD-13): the worker drops the thrown value,
//   and nothing here can reintroduce it.
// - The snapshot types contain no credential field (AD-15) — key material has
//   exactly one home (KeyStore, `qd:key:{id}`), so it cannot leak through
//   this wrapper.
// - `read` shape-validates stored bytes: anything that is not a CycleSnapshot
//   reads as `undefined` ("no cycle yet"), never as garbage for the popup.
//
// The area is injected (AD-1/AD-12): production passes `BrowserApi.storage.local`
// (platform/browser-api.ts); tests pass the in-memory fake from src/testing/.
import type { ProviderId } from '../core/provider';
import type { LineItem, NormalizedUsage } from '../core/usage';
import type { StorageArea } from './key-store';

/** Storage key for the last completed cycle snapshot. */
export const SNAPSHOT_STORAGE_KEY = 'qd:snapshot';

/** One provider's outcome in the last completed cycle. */
export type ProviderSnapshotEntry =
  | { readonly status: 'ok'; readonly usage: NormalizedUsage }
  | { readonly status: 'error' }; // no payload by design (AD-13)

/**
 * The last completed refresh cycle: one entry per provider that had a stored
 * key when the cycle ran. An absent id means "no key at cycle time" — the
 * popup derives its own no-key state from KeyStore, not from here.
 */
export interface CycleSnapshot {
  readonly results: Readonly<Partial<Record<ProviderId, ProviderSnapshotEntry>>>;
}

function isLineItem(value: unknown): value is LineItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return typeof item.model === 'string' && typeof item.usageType === 'string' && typeof item.value === 'number';
}

function isNormalizedUsage(value: unknown): value is NormalizedUsage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const usage = value as Record<string, unknown>;
  return (
    typeof usage.providerId === 'string' &&
    (usage.kind === 'balance' || usage.kind === 'cost') &&
    typeof usage.value === 'number' &&
    typeof usage.currency === 'string' &&
    (usage.tier === undefined || typeof usage.tier === 'string') &&
    (usage.breakdown === undefined || (Array.isArray(usage.breakdown) && usage.breakdown.every(isLineItem))) &&
    typeof usage.fetchedAt === 'number'
  );
}

function isProviderSnapshotEntry(value: unknown): value is ProviderSnapshotEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (entry.status === 'error') {
    return true;
  }
  return entry.status === 'ok' && isNormalizedUsage(entry.usage);
}

function isCycleSnapshot(value: unknown): value is CycleSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const results = (value as Record<string, unknown>).results;
  if (typeof results !== 'object' || results === null) {
    return false;
  }
  return Object.values(results).every(isProviderSnapshotEntry);
}

/** Typed wrapper over the `qd:snapshot` key — the KeyStore wrapper pattern (AD-12). */
export class SnapshotStore {
  constructor(private readonly local: StorageArea) {}

  /** Persists a completed cycle; a single set() keeps the cycle atomic. */
  async write(snapshot: CycleSnapshot): Promise<void> {
    await this.local.set({ [SNAPSHOT_STORAGE_KEY]: snapshot });
  }

  /** Reads the last completed cycle; `undefined` = no valid snapshot yet. */
  async read(): Promise<CycleSnapshot | undefined> {
    const items = await this.local.get(SNAPSHOT_STORAGE_KEY);
    const value = items[SNAPSHOT_STORAGE_KEY];
    return isCycleSnapshot(value) ? value : undefined;
  }
}
