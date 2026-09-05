// Credential validation (provider-framework spec §Qwen — DashScope key rejected).
//
// Pure checks per CredentialType; storage and UI layers call this before a key is
// persisted or used. No I/O, no provider knowledge beyond the credential type.
import type { CredentialType } from './provider';

export type CredentialValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Guidance emitted when a DashScope-style `sk-` key is offered for Qwen: the
 * endpoint is Alibaba BSS, which only accepts account AK/SK pairs whose RAM
 * user carries `bss:DescribeAcccount`.
 */
export const QWEN_AK_SK_GUIDANCE =
  'Qwen usage comes from Alibaba Cloud BSS (QueryAccountBalance) and requires an ' +
  'Alibaba Cloud AK/SK pair (AccessKeyId/AccessKeySecret) whose RAM user has the ' +
  'bss:DescribeAcccount permission. DashScope sk- keys do not work here.';

/** Empty/blank credentials are never acceptable, for any type. */
const EMPTY_MESSAGE = 'Credential must not be empty.';

export function validateCredential(type: CredentialType, credential: string): CredentialValidation {
  if (credential.trim().length === 0) {
    return { ok: false, message: EMPTY_MESSAGE };
  }
  // Qwen (ak-sk): DashScope `sk-` keys are structurally wrong for BSS (spec scenario).
  if (type === 'ak-sk' && credential.startsWith('sk-')) {
    return { ok: false, message: QWEN_AK_SK_GUIDANCE };
  }
  return { ok: true };
}
