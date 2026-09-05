import { describe, expect, it } from 'vitest';
import { signBssQuery } from './rpc-signer';

// AD-18: pure, deterministic BSS 2017-12-14 signer. Both vectors were
// computed offline with Node `crypto` over the identical canonicalization
// (RFC-3986 percent-encoding, sorted keys, `GET&%2F&` prefix, HMAC-SHA1 over
// `secret + '&'`). Production runs the same bytes through Web Crypto
// (SubtleCrypto — the only HMAC available in an MV3 service worker).
const PINNED_BASE = {
  AccessKeyId: 'LTAI5tTestAccessKeyId',
  Action: 'QueryAccountBalance',
  Format: 'JSON',
  Version: '2017-12-14',
};
const PINNED_INPUTS = { timestamp: '2026-09-05T08:00:00Z', nonce: '9e7f80c0-test-nonce-0001' };
const PINNED_SECRET = 'TestSecretKey0000000000000000000000';

describe('signBssQuery (AD-18)', () => {
  it('produces the pinned signature for the fixed BSS vector', async () => {
    const { signature } = await signBssQuery(PINNED_BASE, PINNED_SECRET, PINNED_INPUTS);
    expect(signature).toBe('xmAUc1KiUFczd0HBbplKPgXLEDU=');
  });

  it('returns the query as base params plus the four common params, Signature NOT inside', async () => {
    const { query } = await signBssQuery(PINNED_BASE, PINNED_SECRET, PINNED_INPUTS);
    expect(query).toEqual({
      ...PINNED_BASE,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: PINNED_INPUTS.nonce,
      Timestamp: PINNED_INPUTS.timestamp,
    });
    expect('Signature' in query).toBe(false);
  });

  it('RFC-3986-encodes edges: * -> %2A, ~ passthrough, space -> %20, : -> %3A (edge vector)', async () => {
    const { signature } = await signBssQuery(
      { Action: 'Edge*Case', Format: 'JSON~test', Note: 'a b: c' },
      'EdgeSecret999',
      { timestamp: '2026-09-05T00:00:00Z', nonce: 'edge-nonce-1' },
    );
    expect(signature).toBe('53QIlfMkNL/I5m/EgyKOVkzACXg=');
  });

  it('is deterministic per inputs and varies with the nonce (injected, not ambient)', async () => {
    const first = await signBssQuery(PINNED_BASE, PINNED_SECRET, PINNED_INPUTS);
    const repeat = await signBssQuery(PINNED_BASE, PINNED_SECRET, PINNED_INPUTS);
    const other = await signBssQuery(PINNED_BASE, PINNED_SECRET, {
      ...PINNED_INPUTS,
      nonce: 'different-nonce-0002',
    });
    expect(repeat.signature).toBe(first.signature);
    expect(other.signature).not.toBe(first.signature);
  });

  it('the access key secret never appears in any returned surface', async () => {
    const { query, signature } = await signBssQuery(PINNED_BASE, PINNED_SECRET, PINNED_INPUTS);
    expect(JSON.stringify({ query, signature })).not.toContain(PINNED_SECRET);
  });
});
