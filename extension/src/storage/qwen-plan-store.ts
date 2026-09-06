// QwenPlanStore (usage-badge spec §Qwen Plan Probe Cadence; hito-8) — the
// TTL cache for the qwen plan probe under `qd:qwen-plan-status`.
//
// Persistence contract (SnapshotStore validation pattern, AD-12):
// - The cached probe outcome `{status, resetAt?, probedAt}` lives exclusively
//   in the injected `chrome.storage.local` area; `probedAt` (epoch ms) is the
//   TTL base — available reuses for 120 min, exhausted/key-rejected for 15.
// - `read` shape-validates stored bytes: anything that is not a QwenPlanStatus
//   reads as `undefined` ("no cache yet"), never as garbage for the tick.
// - The key sits OUTSIDE the credential namespace (`qd:key:*`): it carries no
//   key material and is never masked — it is cycle state, not a credential.
//
// The area is injected (AD-1): production passes `BrowserApi.storage.local`;
// tests pass the in-memory fake from src/testing/.
import type { PlanStatus } from '../core/usage';
import type { StorageArea } from './key-store';

/** Storage key for the cached qwen plan probe status. */
export const QWEN_PLAN_STATUS_STORAGE_KEY = 'qd:qwen-plan-status';

/** One cached probe outcome; `probedAt` is the TTL base instant. */
export interface QwenPlanStatus {
  readonly status: PlanStatus;
  /** Reset instant (epoch ms) parsed from the 429 text; absent when n/a. */
  readonly resetAt?: number;
  readonly probedAt: number;
}

const PLAN_STATUSES: readonly PlanStatus[] = ['available', 'exhausted', 'key-rejected'];

function isQwenPlanStatus(value: unknown): value is QwenPlanStatus {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.status === 'string' &&
    PLAN_STATUSES.includes(entry.status as PlanStatus) &&
    (entry.resetAt === undefined || typeof entry.resetAt === 'number') &&
    typeof entry.probedAt === 'number'
  );
}

/** Typed wrapper over `qd:qwen-plan-status` — the KeyStore wrapper pattern. */
export class QwenPlanStore {
  constructor(private readonly local: StorageArea) {}

  /** Persists a probe outcome; one set() keeps the entry atomic. */
  async write(status: QwenPlanStatus): Promise<void> {
    await this.local.set({ [QWEN_PLAN_STATUS_STORAGE_KEY]: status });
  }

  /** Reads the cached outcome; `undefined` = no valid cache yet. */
  async read(): Promise<QwenPlanStatus | undefined> {
    const value = (await this.local.get(QWEN_PLAN_STATUS_STORAGE_KEY))[QWEN_PLAN_STATUS_STORAGE_KEY];
    return isQwenPlanStatus(value) ? value : undefined;
  }
}
