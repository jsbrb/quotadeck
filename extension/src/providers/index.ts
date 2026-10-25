// Default registry wiring (AD-6, AD-24). Lives in providers/, not core/, so
// the core stays free of provider implementations (AD-1). The registration
// order comes from PROVIDER_METADATA (AD-6 order: zai, qwen, openai, kimi) —
// the engine refreshes in registration order, which makes the badge's "last
// result wins" deterministic.
import { ProviderRegistry } from '../core/registry';
import { PROVIDER_METADATA, SHIPPED_PROVIDER_IDS } from '../core/provider-metadata';
import type { Provider, ProviderId } from '../core/provider';
import { DeepSeekProvider } from './deepseek';
import { KimiProvider } from './kimi';
import { OpenAiProvider } from './openai';
import { QwenProvider } from './qwen';
import { ZaiProvider } from './zai';

export { DeepSeekProvider, KimiProvider, OpenAiProvider, QwenProvider, ZaiProvider };

/** Concrete class per metadata id — metadata stays free of implementations. */
const PROVIDER_CLASSES: Readonly<Record<ProviderId, () => Provider>> = {
  zai: () => new ZaiProvider(),
  // Unregistered below (hito-12 WU-L): the class stays wired and exported for
  // a future pay-as-you-go balance — no BSS code is deleted.
  qwen: () => new QwenProvider(),
  openai: () => new OpenAiProvider(),
  kimi: () => new KimiProvider(),
  // hito-13: shipped (registry-dispatched like zai) — the manifest host and
  // the SHIPPED flip landed in WU-B, keeping the shipped
  // manifest = allowlist ∩ SHIPPED invariant green at every commit.
  deepseek: () => new DeepSeekProvider(),
};

/**
 * Providers the ENGINE dispatches for a cycle (hito-12 WU-L, product decision
 * 2026-10-25): qwen is QUOTA-ONLY — the BSS balance leg is SUSPENDED because
 * a coding-plan subscription balance is noise ($0.00) and the balance leg's
 * error-wins merge would suppress a perfectly good quota. The qwen popup card
 * still renders: the tick-level QwenQuotaStep synthesizes the quota-only ok
 * entry and QwenPlanStep merges the plan probe, both OUTSIDE this registry
 * (background.ts). SHIPPED_PROVIDER_IDS deliberately KEEPS qwen — popup
 * visibility, the badge-provider choice and the manifest host pinning all
 * subset through it.
 *
 * deepseek joins as REGISTRY-DISPATCHED (hito-13 WU-A): a plain balance
 * provider like zai — the engine's page pipeline parses it, never a
 * tick-level step. It actually registers once SHIPPED_PROVIDER_IDS gains it
 * (WU-B, together with the allowlist host — see PROVIDER_CLASSES above).
 */
export const ENGINE_DISPATCHED_PROVIDER_IDS: readonly ProviderId[] = ['zai', 'deepseek'];

/**
 * Registry built from PROVIDER_METADATA in its pinned order, filtered to the
 * shipped AND engine-dispatched intersection (hito-10 shipping filter, hito-12
 * WU-L quota-only qwen): everything else stays in source but never registers,
 * so the worker refreshes only the dispatched providers.
 */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const { id } of PROVIDER_METADATA) {
    if (SHIPPED_PROVIDER_IDS.includes(id) && ENGINE_DISPATCHED_PROVIDER_IDS.includes(id)) {
      registry.register(PROVIDER_CLASSES[id]());
    }
  }
  return registry;
}
