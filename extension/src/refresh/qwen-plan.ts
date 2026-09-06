// QwenPlanStep (usage-badge spec §Qwen Plan Probe Cadence; hito-8 design
// note 2) — the TICK-LEVEL probe composition, deliberately OUTSIDE
// RefreshEngine.refresh: the engine is credential-agnostic and
// single-credential-per-provider by design, while this step owns the SECOND
// qwen credential (the `sk-sp-` plan key) and its TTL cache.
//
// Contract (spec §Qwen Plan Probe Cadence):
// - Runs only when a plan key is stored — no key, no probe, no plan status.
// - At most one probe per cache window: a cached `available` outcome is
//   reused for 120 minutes, `exhausted` and `key-rejected` for 15 each
//   (floor: never more than one probe per 15 minutes in any state).
// - A probe outcome that maps (2xx/429/401/403) rewrites the cache and rides
//   the qwen cycle result; anything else (unmapped status like 500, or a
//   transport-layer rejection) leaves the cache UNTOUCHED and omits plan
//   status for this tick.
// - Each probe costs one 1-token inference — the research cadence (~2h/~15m)
// - The reset instant parses from the surfaced 429 error text, never from
//   headers (design note 4): the transport port carries none.
import type { PlanInfo, PlanStatus } from '../core/usage';
import { HttpStatusError } from '../network/fetch-transport';
import type { AllowlistNetworkClient } from '../network/client';
import { buildPlanProbeRequest, mapProbeOutcome } from '../providers/qwen-plan-probe';
import type { KeyStore } from '../storage/key-store';
import type { QwenPlanStore } from '../storage/qwen-plan-store';

/** Cached `available` is reused without probing for this long. */
export const PLAN_CACHE_TTL_AVAILABLE_MS = 120 * 60_000;
/** Cached `exhausted` / `key-rejected` reuse window — also the probe floor. */
export const PLAN_CACHE_TTL_OTHER_MS = 15 * 60_000;

function cacheTtlMs(status: PlanStatus): number {
  return status === 'available' ? PLAN_CACHE_TTL_AVAILABLE_MS : PLAN_CACHE_TTL_OTHER_MS;
}

export interface QwenPlanStepDeps {
  /** Allowlist-enforcing client — the probe never touches a Transport directly. */
  readonly client: AllowlistNetworkClient;
  /** Stored credentials; the plan key lives in the `qwen-plan` slot. */
  readonly keys: KeyStore;
  /** TTL cache wrapper over `qd:qwen-plan-status`. */
  readonly store: QwenPlanStore;
}

export class QwenPlanStep {
  constructor(private readonly deps: QwenPlanStepDeps) {}

  /**
   * Resolves the plan status for one tick. `nowMs` comes from the caller's
   * injected clock (TTL base, reset-year derivation, probedAt stamp).
   */
  async resolve(nowMs: number): Promise<PlanInfo | undefined> {
    const credential = await this.deps.keys.readCredential('qwen-plan', 'qwen-plan');
    if (credential === undefined) {
      return undefined; // no plan key → no probe, no plan status
    }
    const cached = await this.deps.store.read();
    if (cached !== undefined && nowMs - cached.probedAt < cacheTtlMs(cached.status)) {
      return cached.resetAt === undefined ? { status: cached.status } : { status: cached.status, resetAt: cached.resetAt };
    }
    try {
      const response = await this.deps.client.send('qwen', buildPlanProbeRequest(), credential);
      return await this.record(mapProbeOutcome(response.status, undefined, nowMs), nowMs, response.status);
    } catch (error) {
      if (!(error instanceof HttpStatusError)) {
        // Permanent diagnostics (hito-7 parity): a transport-layer probe
        // failure writes no cache and no plan status — without this log it
        // would be completely invisible in production.
        console.error(
          '[quotadeck] qwen plan probe failed:',
          error instanceof Error ? `${error.name}: ${error.message}` : error,
        );
        return undefined; // transport failure: cache untouched, plan omitted
      }
      return await this.record(mapProbeOutcome(error.status, error.message, nowMs), nowMs, error.status);
    }
  }

  /** Persists a mapped outcome as the new cache entry and returns it. */
  private async record(outcome: PlanInfo | undefined, nowMs: number, status: number): Promise<PlanInfo | undefined> {
    if (outcome === undefined) {
      // Permanent diagnostics: unmapped statuses (e.g. 5xx) skip the cache by
      // design — this log is the only trace they ever happened.
      console.error(`[quotadeck] qwen plan probe unmapped status: ${status} — cache untouched, plan omitted.`);
      return undefined; // unmapped status (e.g. 5xx): cache untouched
    }
    await this.deps.store.write({ ...outcome, probedAt: nowMs });
    return outcome;
  }
}
