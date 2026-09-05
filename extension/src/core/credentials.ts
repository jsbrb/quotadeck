// Credential validation (provider-framework spec §Qwen — DashScope key
// rejected; §Qwen AK/SK Pair Handling, AD-17).
//
// Pure checks per CredentialType; storage and UI layers call this before a
// key is persisted or used. No I/O, no provider knowledge beyond the
// credential type. The ak-sk type has TWO modes: a legacy single-string check
// (token-shaped inputs, still used by the transitional popup forms) and the
// pair mode introduced with live usage — pairs reject empty/missing parts and
// DashScope `sk-` values in EITHER part. The raw type (AD-25, ZAI monitor
// key) validates through the same string path as any token: non-empty is the
// only constraint — the client attaches it verbatim on the ZAI monitor hosts.
import type { CredentialType } from './provider';

export type CredentialValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** A candidate Alibaba Cloud AccessKeyId/AccessKeySecret pair. */
export interface AccessKeyPair {
  readonly accessKeyId: string;
  readonly accessKeySecret: string;
}

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

export function validateCredential(type: CredentialType, credential: string): CredentialValidation;
export function validateCredential(type: 'ak-sk', pair: AccessKeyPair): CredentialValidation;
export function validateCredential(
  type: CredentialType,
  credential: string | AccessKeyPair,
): CredentialValidation {
  if (typeof credential !== 'string') {
    // ak-sk pair mode (AD-17): both parts required; `sk-` in either part is a
    // DashScope key offered for BSS — rejected with the guidance.
    if (credential.accessKeyId.trim().length === 0 || credential.accessKeySecret.trim().length === 0) {
      return { ok: false, message: EMPTY_MESSAGE };
    }
    if (credential.accessKeyId.startsWith('sk-') || credential.accessKeySecret.startsWith('sk-')) {
      return { ok: false, message: QWEN_AK_SK_GUIDANCE };
    }
    return { ok: true };
  }
  if (credential.trim().length === 0) {
    return { ok: false, message: EMPTY_MESSAGE };
  }
  // Qwen (ak-sk): DashScope `sk-` keys are structurally wrong for BSS (spec scenario).
  if (type === 'ak-sk' && credential.startsWith('sk-')) {
    return { ok: false, message: QWEN_AK_SK_GUIDANCE };
  }
  return { ok: true };
}
