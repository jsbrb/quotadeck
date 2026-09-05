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

/** The four providers in the AD-6 order (refresh and badge order). */
export const PROVIDER_METADATA: readonly ProviderMetadata[] = [
  { id: 'zai', displayName: 'ZAI (Zhipu AI)', credentialType: 'raw' },
  { id: 'qwen', displayName: 'Qwen (Alibaba Cloud BSS)', credentialType: 'ak-sk' },
  { id: 'openai', displayName: 'OpenAI', credentialType: 'openai-admin-read' },
  { id: 'kimi', displayName: 'Kimi (Moonshot AI)', credentialType: 'bearer' },
];
