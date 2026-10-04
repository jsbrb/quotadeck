// Per-provider domain allowlist (network-allowlist spec §Per-Provider Domain
// Allowlist, AD-4/AD-5/AD-29).
//
// SINGLE SOURCE OF TRUTH: the fenced `json` block in `docs/spike/endpoints.md`.
// This constant is the typed copy; `allowlist.source.test.ts` deep-strict-equals
// the doc block against it, so any drift (e.g. someone re-adding the retired
// apex `bigmodel.cn`) fails the build.
import type { ProviderId } from '../core/provider';

/** How the endpoint evidence was verified (see docs/spike/endpoints.md). */
export type AllowlistVerification = 'official' | 'community';

export interface AllowlistEntry {
  /** Official endpoint domains for the provider; suffix-matched per AD-5. */
  readonly hosts: readonly string[];
  readonly verification: AllowlistVerification;
}

export type AllowlistConfig = Readonly<Record<ProviderId, AllowlistEntry>>;

/** Typed copy of the doc allowlist — keep structurally identical to the doc block. */
export const PROVIDER_ALLOWLIST: AllowlistConfig = {
  zai: { hosts: ['api.z.ai', 'open.bigmodel.cn'], verification: 'community' },
  qwen: {
    hosts: [
      'business.aliyuncs.com',
      'business.ap-southeast-1.aliyuncs.com',
      'token-plan.ap-southeast-1.maas.aliyuncs.com',
    ],
    verification: 'official',
  },
  openai: { hosts: ['api.openai.com'], verification: 'official' },
  kimi: { hosts: ['api.moonshot.cn'], verification: 'official' },
};

/**
 * Host-suffix match scoped per provider (AD-5): the host equals a pattern or is
 * a subdomain of it (`edge.api.z.ai` is admitted under `api.z.ai`;
 * `notbigmodel.cn` and `api.z.ai.evil.com` are not). A request is checked
 * only against its own provider's list, so another provider's allowlisted host
 * is still rejected.
 */
export function isHostAllowed(providerId: ProviderId, host: string): boolean {
  const entry = PROVIDER_ALLOWLIST[providerId];
  const normalized = host.toLowerCase();
  return entry.hosts.some(
    (pattern) => normalized === pattern || normalized.endsWith(`.${pattern}`),
  );
}
