// ACS3-HMAC-SHA256 request signing (hito-12) — pure module, injected date and
// nonce, Web Crypto only (`crypto.subtle` is the only HMAC available in an MV3
// service worker — same constraint as rpc-signer.ts; AD-19: no ambient time).
//
// LIVE-PROVEN RECIPE (docs/spike/endpoints.md §Qwen token-plan quota —
// session-token surface, mint bullets; maintainer headless probe 2026-10-25):
//   1. pre-auth header map: `content-type`, `host`, `x-acs-action`,
//      `x-acs-content-sha256` = hex(sha256(body)), `x-acs-date` (ISO-8601 UTC
//      with the millisecond block stripped), `x-acs-signature-nonce`,
//      `x-acs-version`; optional STS adds `x-acs-security-token`;
//   2. signed names = host | content-type | x-acs-*, lowercase, sorted;
//      canonicalHeaders = `name:value` lines joined with '\n' PLUS one
//      trailing '\n';
//   3. canonicalRequest = [METHOD, pathname, canonicalQuery, canonicalHeaders,
//      signedNames, hashedPayload].join('\n') — because canonicalHeaders
//      already ends with '\n', the join inserts a BLANK LINE between the
//      headers block and the SignedHeaders line; a missing or extra newline
//      there is the classic SignatureDoesNotMatch trap (live-documented);
//   4. stringToSign = 'ACS3-HMAC-SHA256\n' + hex(sha256(canonicalRequest));
//   5. signature = hex(hmac-sha256(accessKeySecret, stringToSign));
//   6. authorization = `ACS3-HMAC-SHA256 Credential=<raw AccessKeyId>,
//      SignedHeaders=<a;b;c>,Signature=<hex>` — literal commas with no
//      surrounding spaces, the AccessKeyId kept RAW (matches the proven probe).
//
// SCOPE: the canonical query is pinned to '' — the ONLY live-proven ACS3 call
// in this repo is the query-less token mint. The client seam refuses marked
// requests that carry query params; query-bearing ACS3 belongs to a later unit
// carrying its own live evidence. No unproven canonicalization ships here.
//
// The secret enters this module and the HMAC only. It never appears in any
// returned surface or in a thrown message.
export interface Acs3SignInputs {
  readonly method: 'GET' | 'POST';
  /** Bare hostname sent as the `host` signed header. */
  readonly host: string;
  /** URL pathname, e.g. '/modelstudio/cli/generateAccessToken'. */
  readonly pathname: string;
  /** x-acs-action value. */
  readonly action: string;
  /** x-acs-version value. */
  readonly version: string;
  /** ISO-8601 UTC with milliseconds stripped — injected, never read here. */
  readonly date: string;
  /** x-acs-signature-nonce — injected, never generated here. */
  readonly nonce: string;
  /** Serialized body, hashed and signed as-is; '' when bodyless. */
  readonly body: string;
  readonly accessKeyId: string;
  readonly accessKeySecret: string;
  /** Optional STS credential signed as x-acs-security-token. */
  readonly securityToken?: string;
}

export interface Acs3Signed {
  /** The lowercase signed header map, exactly as the live probe emitted it. */
  readonly headers: Readonly<Record<string, string>>;
  readonly authorization: string;
  /** Exposed for known-answer tests — callers never transmit it. */
  readonly canonicalRequest: string;
  /** Exposed for known-answer tests — callers never transmit it. */
  readonly stringToSign: string;
}

/** Refuses empty key material BEFORE hashing; the message never carries credential material. */
export class Acs3SigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Acs3SigningError';
  }
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hexSha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/**
 * Recipe step 2. Assumes lowercase header names (signAcs3 builds the map
 * lowercase): keeps host | content-type | x-acs-*, sorted, one trailing '\n'
 * on the headers block — the blank-line seam in buildAcs3CanonicalRequest
 * depends on it.
 */
export function canonicalAcs3Headers(
  headers: Readonly<Record<string, string>>,
): { canonicalHeaders: string; signedHeaders: string } {
  const signed = Object.entries(headers)
    .filter(([name]) => name === 'host' || name === 'content-type' || name.startsWith('x-acs-'))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    canonicalHeaders: `${signed.map(([name, value]) => `${name}:${value}`).join('\n')}\n`,
    signedHeaders: signed.map(([name]) => name).join(';'),
  };
}

/**
 * Recipe step 3. The canonical query is the empty string (mint-only seam —
 * see header comment): METHOD\npathname\n\nheaders…\nsigned\npayload. Because
 * canonicalHeaders itself ends with '\n', the join inserts the BLANK LINE
 * before signedHeaders — the documented SignatureDoesNotMatch trap.
 */
export function buildAcs3CanonicalRequest(parts: {
  readonly method: string;
  readonly pathname: string;
  readonly canonicalHeaders: string;
  readonly signedHeaders: string;
  readonly hashedPayload: string;
}): string {
  return [
    parts.method,
    parts.pathname,
    '',
    parts.canonicalHeaders,
    parts.signedHeaders,
    parts.hashedPayload,
  ].join('\n');
}

/** Recipe step 4. */
export async function buildAcs3StringToSign(canonicalRequest: string): Promise<string> {
  return `ACS3-HMAC-SHA256\n${await hexSha256(canonicalRequest)}`;
}

/** Signs the request per the live-proven recipe; pure over the injected date/nonce. */
export async function signAcs3(inputs: Acs3SignInputs): Promise<Acs3Signed> {
  if (inputs.accessKeyId.length === 0 || inputs.accessKeySecret.length === 0) {
    throw new Acs3SigningError('ACS3 signing needs a non-empty AccessKeyId and AccessKeySecret.');
  }
  const hashedPayload = await hexSha256(inputs.body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: inputs.host,
    'x-acs-action': inputs.action,
    'x-acs-content-sha256': hashedPayload,
    'x-acs-date': inputs.date,
    'x-acs-signature-nonce': inputs.nonce,
    'x-acs-version': inputs.version,
  };
  if (inputs.securityToken !== undefined && inputs.securityToken.length > 0) {
    headers['x-acs-security-token'] = inputs.securityToken;
  }
  const { canonicalHeaders, signedHeaders } = canonicalAcs3Headers(headers);
  const canonicalRequest = buildAcs3CanonicalRequest({
    method: inputs.method,
    pathname: inputs.pathname,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  });
  const stringToSign = await buildAcs3StringToSign(canonicalRequest);

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(inputs.accessKeySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
  const authorization = `ACS3-HMAC-SHA256 Credential=${inputs.accessKeyId},SignedHeaders=${signedHeaders},Signature=${toHex(mac)}`;
  return { headers, authorization, canonicalRequest, stringToSign };
}
