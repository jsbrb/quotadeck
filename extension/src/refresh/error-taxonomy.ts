// Refresh error taxonomy (AD-21) — signal → class, honestly pinned.
//
// Pure classification over typed errors; `background.refreshTick` applies it
// in `onError` and the snapshot entry carries the resulting class. The spike
// (docs/spike/endpoints.md) documents NO body-level rate-limit signal for any
// of the four providers — only HTTP 429 is `rate-limit`; a documented
// body-level signal remains an extension point.
import { HttpStatusError, ResponseParseError } from '../network/fetch-transport';
import { ProviderApiError } from '../core/provider';

export type ErrorClass = 'auth' | 'rate-limit' | 'server' | 'network' | 'unknown';

/** Maps a refresh failure to its taxonomy class (AD-21 design table). */
export function classifyRefreshError(error: unknown): ErrorClass {
  if (error instanceof HttpStatusError) {
    if (error.status === 401 || error.status === 403) {
      return 'auth';
    }
    if (error.status === 429) {
      return 'rate-limit';
    }
    if (error.status >= 500) {
      return 'server';
    }
    return 'unknown';
  }
  if (error instanceof TypeError) {
    return 'network'; // fetch rejects with TypeError on network failure
  }
  if (error instanceof ResponseParseError) {
    return 'unknown';
  }
  if (error instanceof ProviderApiError) {
    return 'server'; // body-level non-200 semantics (e.g. ZAI numeric code)
  }
  return 'unknown';
}
