import { describe, expect, it } from 'vitest';
import { Acs3SigningError, signAcs3, type Acs3SignInputs } from './acs3-signer';

// AD-18 sibling (hito-12): pure, deterministic ACS3-HMAC-SHA256 signer. The
// vector below was computed offline with Node `crypto` over the live-proven
// mint canonicalization (docs/spike/endpoints.md §Qwen token-plan quota —
// session-token surface, mint bullets); production runs the same bytes through
// Web Crypto (SubtleCrypto — the only HMAC available in an MV3 service
// worker). SYNTHETIC credentials only — no real key material exists here.
const SYNTH_KEY_ID = 'LTAISyntheticTestKeyNeverReal';
const SYNTH_SECRET = 'synthetic-secret-never-real';
const FIXED_DATE = '2026-10-25T12:00:00Z'; // milliseconds already stripped (injected)
const FIXED_NONCE = 'acs3-test-nonce-000000000001'; // injected
const BODY = '{}';
const HASHED_BODY = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
const SIGNED_HEADERS =
  'content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version';

// The seam that must never regress: the canonical-headers block ends with its
// OWN trailing '\n' and the section join adds another — a BLANK LINE sits
// between the headers block and the SignedHeaders line. A missing or extra
// newline there is the classic SignatureDoesNotMatch trap (live-documented).
const EXPECTED_CANONICAL_REQUEST = [
  'POST',
  '/modelstudio/cli/generateAccessToken',
  '', // canonical query — the live-proven mint shape is query-less
  'content-type:application/json',
  'host:modelstudio.ap-southeast-1.aliyuncs.com',
  'x-acs-action:GenerateCLIAccessToken',
  `x-acs-content-sha256:${HASHED_BODY}`,
  `x-acs-date:${FIXED_DATE}`,
  `x-acs-signature-nonce:${FIXED_NONCE}`,
  'x-acs-version:2026-02-10',
  '', // <-- the blank line: trailing '\n' of the headers block + join '\n'
  SIGNED_HEADERS,
  HASHED_BODY,
].join('\n');

const EXPECTED_STRING_TO_SIGN = `ACS3-HMAC-SHA256\n06d291ca64b84a6b30f1e5f8542fc3bb6102e6e790476207c66177327d3cbd13`;
const EXPECTED_SIGNATURE = '3e7c5352242a7c5989616e06f03f897e7f46d5aea358c7d6d26a68c4715b6317';
const EXPECTED_AUTHORIZATION = `ACS3-HMAC-SHA256 Credential=${SYNTH_KEY_ID},SignedHeaders=${SIGNED_HEADERS},Signature=${EXPECTED_SIGNATURE}`;

function mintInputs(overrides: Partial<Acs3SignInputs> = {}): Acs3SignInputs {
  return {
    method: 'POST',
    host: 'modelstudio.ap-southeast-1.aliyuncs.com',
    pathname: '/modelstudio/cli/generateAccessToken',
    action: 'GenerateCLIAccessToken',
    version: '2026-02-10',
    date: FIXED_DATE,
    nonce: FIXED_NONCE,
    body: BODY,
    accessKeyId: SYNTH_KEY_ID,
    accessKeySecret: SYNTH_SECRET,
    ...overrides,
  };
}

describe('signAcs3 — ACS3-HMAC-SHA256 (hito-12 live-proven mint recipe)', () => {
  it('pins the exact canonicalRequest for the fixed vector, blank-line seam included', async () => {
    const signed = await signAcs3(mintInputs());
    expect(signed.canonicalRequest).toBe(EXPECTED_CANONICAL_REQUEST);
    // Spell the seam out independently of the block literal above.
    expect(signed.canonicalRequest).toContain('x-acs-version:2026-02-10\n\ncontent-type;host;');
    expect(signed.canonicalRequest).not.toContain('\n\n\n');
  });

  it('pins stringToSign and the authorization header as known answers', async () => {
    const signed = await signAcs3(mintInputs());
    expect(signed.stringToSign).toBe(EXPECTED_STRING_TO_SIGN);
    expect(signed.authorization).toBe(EXPECTED_AUTHORIZATION);
  });

  it('emits the full signed header map exactly as the live probe sent it', async () => {
    const signed = await signAcs3(mintInputs());
    expect(signed.headers).toEqual({
      'content-type': 'application/json',
      host: 'modelstudio.ap-southeast-1.aliyuncs.com',
      'x-acs-action': 'GenerateCLIAccessToken',
      'x-acs-content-sha256': HASHED_BODY,
      'x-acs-date': FIXED_DATE,
      'x-acs-signature-nonce': FIXED_NONCE,
      'x-acs-version': '2026-02-10',
    });
  });

  it('adds and signs x-acs-security-token in sorted position when an STS token is supplied', async () => {
    const signed = await signAcs3(mintInputs({ securityToken: 'sts-synthetic-token' }));
    expect(signed.headers['x-acs-security-token']).toBe('sts-synthetic-token');
    expect(signed.canonicalRequest).toContain('x-acs-security-token:sts-synthetic-token\n');
    // Alphabetical: 'security' sorts before 'signature' ('e' < 'i').
    expect(signed.authorization).toContain(
      'SignedHeaders=content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-security-token;x-acs-signature-nonce;x-acs-version,',
    );
    expect(signed.authorization).not.toBe(EXPECTED_AUTHORIZATION);
  });

  it('is deterministic per inputs and varies with the nonce (injected, not ambient)', async () => {
    const first = await signAcs3(mintInputs());
    const repeat = await signAcs3(mintInputs());
    const other = await signAcs3(mintInputs({ nonce: 'acs3-test-nonce-000000000002' }));
    expect(repeat.authorization).toBe(first.authorization);
    expect(other.authorization).not.toBe(first.authorization);
  });

  it('the AccessKeySecret never appears in any returned surface', async () => {
    const signed = await signAcs3(mintInputs());
    expect(JSON.stringify(signed)).not.toContain(SYNTH_SECRET);
  });

  it('missing key material throws with NO credential material in the message', async () => {
    for (const override of [{ accessKeySecret: '' }, { accessKeyId: '' }] as const) {
      const attempt = signAcs3(mintInputs(override));
      await expect(attempt).rejects.toBeInstanceOf(Acs3SigningError);
      await attempt.catch((error: unknown) => {
        const text = `${(error as Error).name}: ${(error as Error).message}`;
        expect(text).not.toContain(SYNTH_SECRET);
        expect(text).not.toContain(SYNTH_KEY_ID);
      });
    }
  });
});
