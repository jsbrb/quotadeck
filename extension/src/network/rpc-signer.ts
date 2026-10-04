// Alibaba BSS RPC signature (AD-18) — pure module, injected timestamp/nonce,
// Web Crypto only.
//
// BSS 2017-12-14 canonicalization (per spike evidence):
//   1. merge common params: SignatureMethod=HMAC-SHA1, SignatureVersion=1.0,
//      SignatureNonce, Timestamp;
//   2. percent-encode keys and values RFC-3986-style (`encodeURIComponent`
//      plus `*` -> `%2A`, `%7E` -> `~` — NOT URLSearchParams, which encodes
//      space as `+` and produces wrong signatures);
//   3. sort by encoded key, join `k=v` with `&`;
//   4. StringToSign = 'GET&%2F&' + pe(canonical);
//   5. Signature = Base64(HMAC-SHA1(secret + '&', StringToSign)).
//
// `crypto.subtle` (SubtleCrypto) is the only HMAC available in an MV3 service
// worker — Node `crypto` does not exist there. The secret enters this module
// and the credential scan; it is never placed in any returned surface — only
// the derived `Signature` and the caller-provided params are transmitted.
/** RFC-3986 percent-encoding over encodeURIComponent (Alibaba POP recipe). */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/\*/g, '%2A').replace(/%7E/g, '~');
}

/** Common BSS params merged into every signed query (AD-18 step 1). */
const COMMON_PARAMS = {
  SignatureMethod: 'HMAC-SHA1',
  SignatureVersion: '1.0',
} as const;

export interface SignInputs {
  readonly timestamp: string;
  readonly nonce: string;
}

/**
 * Signs a BSS RPC GET query deterministically. Returns the query params to
 * dispatch (base + common params, WITHOUT the signature) and the derived
 * `Signature` — the caller appends it to the query.
 */
export async function signBssQuery(
  base: Readonly<Record<string, string>>,
  accessKeySecret: string,
  inputs: SignInputs,
): Promise<{ query: Record<string, string>; signature: string }> {
  const query: Record<string, string> = {
    ...base,
    ...COMMON_PARAMS,
    SignatureNonce: inputs.nonce,
    Timestamp: inputs.timestamp,
  };
  const canonical = Object.keys(query)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(query[key]!)}`)
    .join('&');
  const stringToSign = `GET&%2F&${percentEncode(canonical)}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${accessKeySecret}&`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return { query, signature };
}
