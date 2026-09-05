import { describe, expect, it } from 'vitest';
import { HttpStatusError, ResponseParseError } from '../network/fetch-transport';
import { ProviderApiError } from '../core/provider';
import { classifyRefreshError, type ErrorClass } from './error-taxonomy';

// AD-21: signal → class mapping, honestly pinned. The spike found no
// body-level rate-limit signal for any provider, so only HTTP 429 is
// `rate-limit` (extension point until a provider documents one). Table-driven
// per design: every signal class plus the unknown fallback.
const CASES: ReadonlyArray<{ signal: string; error: unknown; expected: ErrorClass }> = [
  { signal: 'HTTP 401', error: new HttpStatusError(401), expected: 'auth' },
  { signal: 'HTTP 403', error: new HttpStatusError(403), expected: 'auth' },
  { signal: 'HTTP 429', error: new HttpStatusError(429), expected: 'rate-limit' },
  { signal: 'HTTP 500', error: new HttpStatusError(500), expected: 'server' },
  { signal: 'HTTP 503', error: new HttpStatusError(503), expected: 'server' },
  { signal: 'other HTTP status (404)', error: new HttpStatusError(404), expected: 'unknown' },
  { signal: 'fetch network failure (TypeError)', error: new TypeError('fetch failed'), expected: 'network' },
  { signal: 'JSON parse failure', error: new ResponseParseError(), expected: 'unknown' },
  { signal: 'body-level non-200 (ProviderApiError)', error: new ProviderApiError('ZAI body code 500'), expected: 'server' },
  { signal: 'unmapped Error', error: new Error('something else'), expected: 'unknown' },
  { signal: 'non-error thrown value', error: 'boom', expected: 'unknown' },
];

describe('classifyRefreshError (AD-21)', () => {
  it.each(CASES)('classifies $signal → $expected', ({ error, expected }) => {
    expect(classifyRefreshError(error)).toBe(expected);
  });

  it('carries the status on HttpStatusError without response body text', () => {
    // AD-13 spirit: the message must not embed untrusted body content.
    const error = new HttpStatusError(401);
    expect(error.status).toBe(401);
    expect(error.message).toBe('HTTP 401');
  });
});
