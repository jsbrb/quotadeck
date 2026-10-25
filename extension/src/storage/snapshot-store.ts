// SnapshotStore (popup-ui spec §Current Cycle Data on Open; AD-10/AD-12) —
// the worker-persisted, key-free cycle snapshot.
//
// Persistence contract:
// - The last completed refresh cycle's per-provider outcomes live exclusively
//   in the injected `chrome.storage.local` area under the single key
//   `qd:snapshot`. One `write` per completed cycle keeps cycle semantics
//   atomic — a reader never observes half a cycle (AD-10). `write` first
//   reads the previous snapshot to carry the additive `lastKnown` map
//   forward (hito-11); the cycle itself remains the single atomic write.
// - Error entries carry ONLY their taxonomy class (AD-13/21): the worker
//   drops the thrown value, and nothing here can reintroduce it.
// - The snapshot types contain no credential field (AD-15) — key material has
//   exactly one home (KeyStore, `qd:key:{id}`), so it cannot leak through
//   this wrapper.
// - `read` shape-validates stored bytes: anything that is not a CycleSnapshot
//   reads as `undefined` ("no cycle yet"), never as garbage for the popup.
//   Error entries require a valid `errorClass` (AD-21) and ok entries have
//   their `windows` validated when present (AD-26) — a pre-hitó-3 error entry
//   without a class therefore reads as "no cycle yet" until the next tick
//   (≤1 min) rewrites it (transient by design). A pre-hitó-4 `usage.budget`
//   field is simply ignored (unknown keys don't invalidate; AD-26 migration).
//
// The area is injected (AD-1/AD-12): production passes `BrowserApi.storage.local`
// (platform/browser-api.ts); tests pass the in-memory fake from src/testing/.
import type { ProviderId } from '../core/provider';
import type { ErrorClass } from '../refresh/error-taxonomy';
import type { LineItem, MonitorWindows, NormalizedUsage, PlanInfo, TokenPlanQuota } from '../core/usage';
import type { StorageArea } from './key-store';

/** Storage key for the last completed cycle snapshot. */
export const SNAPSHOT_STORAGE_KEY = 'qd:snapshot';

/** One provider's outcome in the last completed cycle. */
export type ProviderSnapshotEntry =
  | { readonly status: 'ok'; readonly usage: NormalizedUsage }
  | { readonly status: 'error'; readonly errorClass: ErrorClass }; // class only (AD-13/21)

/** The ok arm alone — the only shape `lastKnown` persists (hito-11). */
export type ProviderOkEntry = Extract<ProviderSnapshotEntry, { status: 'ok' }>;

/**
 * The last completed refresh cycle: one entry per provider that had a stored
 * key when the cycle ran. An absent id means "no key at cycle time" — the
 * popup derives its own no-key state from KeyStore, not from here.
 */
export interface CycleSnapshot {
  readonly results: Readonly<Partial<Record<ProviderId, ProviderSnapshotEntry>>>;
  /**
   * LAST KNOWN (frozen) surface (hito-11): per provider, the most recent
   * SUCCESSFUL entry across cycles — error ticks never wipe it, later ok
   * ticks update it, providers never seen ok carry no entry. OWNED BY
   * `write`: the merge derives the map from the previously stored snapshot
   * plus the cycle's ok results, so a caller-provided value is recomputed,
   * never honored. Additive: snapshots without the key stay valid.
   */
  readonly lastKnown?: Readonly<Partial<Record<ProviderId, ProviderOkEntry>>>;
}

const ERROR_CLASSES: readonly ErrorClass[] = ['auth', 'rate-limit', 'server', 'network', 'unknown'];

function isLineItem(value: unknown): value is LineItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return typeof item.model === 'string' && typeof item.usageType === 'string' && typeof item.value === 'number';
}

/**
 * AD-26 shape check (live-pinned 2026-09-05): a window requires at least one
 * of percentage/total (a real plan-pro TOKENS_LIMIT carries percentage +
 * resetAt with no total); `used` is valid only alongside both of them.
 */
function isUsageWindow(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const window = value as Record<string, unknown>;
  const percentageValid = window.percentage === undefined || typeof window.percentage === 'number';
  const totalValid = window.total === undefined || typeof window.total === 'number';
  const usedValid =
    window.used === undefined ||
    (typeof window.used === 'number' && typeof window.percentage === 'number' && typeof window.total === 'number');
  return (
    (typeof window.percentage === 'number' || typeof window.total === 'number') &&
    percentageValid &&
    totalValid &&
    usedValid &&
    (window.resetAt === undefined || typeof window.resetAt === 'number')
  );
}

/** AD-26 shape check for the ZAI monitor windows on a stored usage. */
function isMonitorWindows(value: unknown): value is MonitorWindows {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const windows = value as Record<string, unknown>;
  if (
    windows.level !== undefined && typeof windows.level !== 'string' ||
    windows.fiveHour !== undefined && !isUsageWindow(windows.fiveHour) ||
    windows.weekly !== undefined && !isUsageWindow(windows.weekly)
  ) {
    return false;
  }
  const mcp = windows.mcp;
  if (mcp === undefined) {
    return true;
  }
  if (typeof mcp !== 'object' || mcp === null) {
    return false;
  }
  const mcpWindow = mcp as Record<string, unknown>;
  return (
    typeof mcpWindow.used === 'number' &&
    typeof mcpWindow.ceiling === 'number' &&
    Array.isArray(mcpWindow.tools) &&
    mcpWindow.tools.every(
      (tool) =>
        typeof tool === 'object' &&
        tool !== null &&
        typeof (tool as Record<string, unknown>).name === 'string' &&
        typeof (tool as Record<string, unknown>).used === 'number',
    )
  );
}

/** hito-8 shape check: one of the three plan statuses plus an optional numeric resetAt. */
function isPlanInfo(value: unknown): value is PlanInfo {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const plan = value as Record<string, unknown>;
  return (
    (plan.status === 'available' || plan.status === 'exhausted' || plan.status === 'key-rejected') &&
    (plan.resetAt === undefined || typeof plan.resetAt === 'number')
  );
}

/**
 * hito-12 WU-C2 shape check: quota fields are finite-number-or-absent with a
 * required FINITE fetchedAt. The uncapped passthrough (percentage 150) is
 * VALID as stored — validation never clamps; NaN/Infinity/string garbage
 * rejects the whole snapshot exactly like the plan malformed shapes do.
 */
function isTokenPlanQuota(value: unknown): value is TokenPlanQuota {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const quota = value as Record<string, unknown>;
  return (
    (quota.percentage === undefined || (typeof quota.percentage === 'number' && Number.isFinite(quota.percentage))) &&
    (quota.resetAt === undefined || (typeof quota.resetAt === 'number' && Number.isFinite(quota.resetAt))) &&
    typeof quota.fetchedAt === 'number' &&
    Number.isFinite(quota.fetchedAt)
  );
}

function isNormalizedUsage(value: unknown): value is NormalizedUsage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const usage = value as Record<string, unknown>;
  return (
    typeof usage.providerId === 'string' &&
    (usage.kind === 'balance' || usage.kind === 'cost') &&
    // n1 (AD-26): value/currency relaxed to optional — monitor results carry
    // windows instead of a monetary figure.
    (usage.value === undefined || typeof usage.value === 'number') &&
    (usage.currency === undefined || typeof usage.currency === 'string') &&
    (usage.tier === undefined || typeof usage.tier === 'string') &&
    (usage.breakdown === undefined || (Array.isArray(usage.breakdown) && usage.breakdown.every(isLineItem))) &&
    (usage.windows === undefined || isMonitorWindows(usage.windows)) &&
    (usage.plan === undefined || isPlanInfo(usage.plan)) &&
    (usage.quota === undefined || isTokenPlanQuota(usage.quota)) &&
    typeof usage.fetchedAt === 'number'
  );
}

function isProviderSnapshotEntry(value: unknown): value is ProviderSnapshotEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (entry.status === 'error') {
    return typeof entry.errorClass === 'string' && ERROR_CLASSES.includes(entry.errorClass as ErrorClass);
  }
  return entry.status === 'ok' && isNormalizedUsage(entry.usage);
}

/** A lastKnown slot must hold the ok arm specifically (hito-11). */
function isLastKnownEntry(value: unknown): value is ProviderOkEntry {
  return isProviderSnapshotEntry(value) && value.status === 'ok';
}

function isCycleSnapshot(value: unknown): value is CycleSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  const results = snapshot.results;
  if (typeof results !== 'object' || results === null) {
    return false;
  }
  if (!Object.values(results).every(isProviderSnapshotEntry)) {
    return false;
  }
  // `lastKnown` is optional (additive); when present it must be a record of
  // ok entries — garbage reads as "no cycle yet", same strictness as results.
  const lastKnown = snapshot.lastKnown;
  if (lastKnown === undefined) {
    return true;
  }
  return (
    typeof lastKnown === 'object' &&
    lastKnown !== null &&
    Object.values(lastKnown).every(isLastKnownEntry)
  );
}

/** Typed wrapper over the `qd:snapshot` key — the KeyStore wrapper pattern (AD-12). */
export class SnapshotStore {
  constructor(private readonly local: StorageArea) {}

  /**
   * Persists a completed cycle; a single set() keeps the cycle atomic. The
   * `lastKnown` map is OWNED here (hito-11): the previously stored map is
   * carried over and every ok entry of the new cycle overwrites its slot —
   * error entries never touch it, so the most recent success survives later
   * error ticks. An empty map is omitted (no key on all-error cycles).
   */
  async write(snapshot: CycleSnapshot): Promise<void> {
    const previous = await this.read();
    const lastKnown: Partial<Record<ProviderId, ProviderOkEntry>> = { ...previous?.lastKnown };
    for (const [providerId, entry] of Object.entries(snapshot.results)) {
      if (entry !== undefined && entry.status === 'ok') {
        lastKnown[providerId as ProviderId] = entry;
      }
    }
    const stored: CycleSnapshot =
      Object.keys(lastKnown).length === 0
        ? { results: snapshot.results }
        : { results: snapshot.results, lastKnown };
    await this.local.set({ [SNAPSHOT_STORAGE_KEY]: stored });
  }

  /** Reads the last completed cycle; `undefined` = no valid snapshot yet. */
  async read(): Promise<CycleSnapshot | undefined> {
    const items = await this.local.get(SNAPSHOT_STORAGE_KEY);
    const value = items[SNAPSHOT_STORAGE_KEY];
    return isCycleSnapshot(value) ? value : undefined;
  }
}
