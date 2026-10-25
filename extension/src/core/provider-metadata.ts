// Provider metadata (AD-24) — the popup-safe single source of provider
// identity: id, display name, credential type, in the fixed AD-6 order.
// `providers/index.ts` builds the default registry from this list, and the
// popup imports ONLY this module, so provider classes and their endpoint URL
// constants never enter the popup bundle.
import type { CredentialType, ProviderId } from './provider';

export interface ProviderMetadata {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly credentialType: CredentialType;
}

/** The five providers in the AD-6 order (refresh and badge order; deepseek — hito-13). */
export const PROVIDER_METADATA: readonly ProviderMetadata[] = [
  { id: 'zai', displayName: 'ZAI (Zhipu AI)', credentialType: 'raw' },
  { id: 'qwen', displayName: 'Qwen (Alibaba Cloud BSS)', credentialType: 'ak-sk' },
  { id: 'deepseek', displayName: 'DeepSeek', credentialType: 'bearer' },
  { id: 'openai', displayName: 'OpenAI', credentialType: 'openai-admin-read' },
  { id: 'kimi', displayName: 'Kimi (Moonshot AI)', credentialType: 'bearer' },
];

/**
 * Providers shipping in the current build: the single source of the shipping
 * filter. The default registry, the popup composition, and the manifest
 * host_permissions derivation all subset through this list; non-shipped
 * implementations stay in source, unshipped. Order follows the AD-6 registry
 * order (zai then qwen — hito-12 re-ships qwen on this branch for the quota
 * browser E2E; the hito-10 GLM-only store release stays on develop).
 * deepseek (hito-13) stays UNSHIPPED in WU-A — it flips on in WU-B, in the
 * same unit that pins its manifest host, keeping the shipped manifest =
 * allowlist ∩ SHIPPED invariant green at every commit.
 */
export const SHIPPED_PROVIDER_IDS: readonly ProviderId[] = ['zai', 'qwen'];
