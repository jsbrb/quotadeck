// Desktop refresh loop — the composition root for the flyout webview.
//
// Desktop counterpart of the extension's background.ts tick (AD-1), composed
// from the SAME chrome-free pieces over the desktop platform adapters:
// registry → AllowlistNetworkClient over the plugin-http transport →
// RefreshEngine → qwen plan probe + token-plan quota steps → snapshot write.
//
// Why a local tick instead of importing background.ts: that module self-boots
// under `typeof chrome !== 'undefined'`, which is TRUE inside WebView2 (the
// Chromium runtime exposes a window.chrome global) and would crash the import
// constructing ChromeBrowserApi. Every piece imported here is chrome-free;
// buildDesktopTickQuery and the merge discipline below are pinned twins of
// the background.ts originals (same inputs, same outputs, same precedence).

import { SystemClock, type Clock } from "@shared/core/clock";
import type { ProviderId, UsageQuery } from "@shared/core/provider";
import type { ProviderRegistry } from "@shared/core/registry";
import type { QwenSite } from "@shared/core/qwen-sites";
import type { ZaiPlatform } from "@shared/core/zai-platforms";
import { AllowlistNetworkClient } from "@shared/network/client";
import type { Transport } from "@shared/network/transport";
import { createDefaultRegistry } from "@shared/providers";
import { classifyRefreshError } from "@shared/refresh/error-taxonomy";
import { RefreshEngine } from "@shared/refresh/engine";
import { QwenPlanStep } from "@shared/refresh/qwen-plan";
import { QwenQuotaStep } from "@shared/refresh/qwen-quota";
import { readBadgeProvider } from "@shared/storage/badge-provider-store";
import { KeyStore, type StorageArea } from "@shared/storage/key-store";
import { QwenPlanStore } from "@shared/storage/qwen-plan-store";
import { readQwenSite } from "@shared/storage/qwen-site-store";
import { SnapshotStore, type CycleSnapshot, type ProviderSnapshotEntry } from "@shared/storage/snapshot-store";
import { readZaiPlatform } from "@shared/storage/zai-platform-store";

/**
 * OpenAI trailing cost window in seconds — pinned twin of the
 * background.ts product default (unused by the shipped registry today, kept
 * for parity so a future openai registration ticks identically).
 */
const OPENAI_WINDOW_SECONDS = 24 * 3_600;

/**
 * Pinned twin of background.buildTickQuery: the provider-agnostic tick query
 * from the injected clock and the stored platform/site selections (no
 * wall-clock reads inside provider logic).
 */
export function buildDesktopTickQuery(
  clock: Clock,
  zaiPlatform: ZaiPlatform,
  qwenSite: QwenSite,
): UsageQuery {
  const now = clock.now();
  const endTime = Math.floor(now / 1000);
  return {
    zaiPlatform,
    qwenSite,
    now,
    startTime: endTime - OPENAI_WINDOW_SECONDS,
    endTime,
  };
}

/** Injectable composition deps; production binds the desktop defaults. */
export interface DesktopTickDeps {
  /** Non-secret storage: preferences, plan cache, cycle snapshot. */
  readonly prefs: StorageArea;
  /** Secret storage: provider credentials (Windows Credential Manager). */
  readonly secrets: StorageArea;
  /** The desktop transport (plugin-http under the 7-host allowlist). */
  readonly transport: Transport;
  /** Time source for the query derivation and fetchedAt stamps. */
  readonly clock?: Clock;
  /** Override for tests; production uses createDefaultRegistry(). */
  readonly registry?: ProviderRegistry;
}

export interface DesktopTickOutcome {
  readonly snapshot: CycleSnapshot;
  /** The badge-provider preference read this tick (tray icon render, WU-D). */
  readonly badgeProvider: ProviderId;
}

/**
 * One desktop tick: read the platform/site/badge preferences, derive the live
 * query, refresh every keyed provider sequentially (each outcome recorded),
 * merge the qwen plan probe and token-plan quota steps (error arm wins,
 * absent entry synthesizes — exact background.ts precedence), persist ONE
 * snapshot write, and return the fresh snapshot for the UI.
 */
export async function runDesktopRefreshTick(deps: DesktopTickDeps): Promise<DesktopTickOutcome> {
  const clock = deps.clock ?? new SystemClock();
  const prefs = deps.prefs;
  const registry = deps.registry ?? createDefaultRegistry();
  const client = () => new AllowlistNetworkClient(deps.transport);

  const zaiPlatform = await readZaiPlatform(prefs);
  const qwenSite = await readQwenSite(prefs);
  const badgeProvider = await readBadgeProvider(prefs);
  const query = buildDesktopTickQuery(clock, zaiPlatform, qwenSite);

  const engine = new RefreshEngine({
    registry,
    client: client(),
    keys: new KeyStore(deps.secrets),
    clock,
  });
  const planStep = new QwenPlanStep({
    client: client(),
    keys: new KeyStore(deps.secrets),
    store: new QwenPlanStore(prefs),
  });
  const quotaStep = new QwenQuotaStep({
    client: client(),
    keys: new KeyStore(deps.secrets),
  });

  const results: Partial<Record<ProviderId, ProviderSnapshotEntry>> = {};
  await engine.refreshAll(query, {
    onUsage: (usage) => {
      results[usage.providerId] = { status: "ok", usage };
    },
    onError: (providerId, error) => {
      console.error(
        `[quotadeck-desktop] ${providerId} refresh failed:`,
        error instanceof Error ? `${error.name}: ${error.message}` : error,
      );
      results[providerId] = { status: "error", errorClass: classifyRefreshError(error) };
    },
  });

  const plan = await planStep.resolve(clock.now());
  if (plan !== undefined) {
    const entry = results.qwen;
    if (entry === undefined) {
      results.qwen = { status: "ok", usage: { providerId: "qwen", kind: "balance", plan, fetchedAt: clock.now() } };
    } else if (entry.status === "ok") {
      results.qwen = { status: "ok", usage: { ...entry.usage, plan } };
    }
  }

  const quota = await quotaStep.resolve(clock.now(), qwenSite);
  if (quota !== undefined) {
    const entry = results.qwen;
    if (entry === undefined) {
      results.qwen = { status: "ok", usage: { providerId: "qwen", kind: "balance", quota, fetchedAt: clock.now() } };
    } else if (entry.status === "ok") {
      results.qwen = { status: "ok", usage: { ...entry.usage, quota } };
    }
  }

  const store = new SnapshotStore(prefs);
  await store.write({ results });
  const snapshot = await store.read();
  return {
    snapshot: snapshot ?? { results },
    badgeProvider,
  };
}
