// hito-12 WU-H — LIVE CONTRACT: the publish gate.
//
// Purpose: hermetic fixtures repeatedly diverged from the live gateway (WU-F:
// the WAF Origin rejection; WU-G: the real response envelope). This file is
// the permanent answer: it runs the REAL production pipeline — the real
// request builders, the real ACS3 signer through the client's sanctioned
// seam, the real AllowlistNetworkClient, the real FetchTransport over the
// ambient fetch, the real parseTokenPlanUsage — against the live Alibaba
// international endpoints, asserting the quota shape the product depends on.
// Run it before ANY publish/store decision on this feature.
//
// How to run: from the repo root,
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\live-contract.ps1
// The test SKIPS SILENTLY in the normal suite (it is opt-in only): it runs
// just when QUOTADECK_LIVE='1' is set in the environment. Gated ON with the
// credential variables missing the run FAILS with an actionable message —
// a half-open gate is never a silent pass.
//
// Security: credentials are read from THIS process's environment only (set
// in memory by scripts/live-contract.ps1, never on disk, never printed). The
// minted session token lives in one local variable and dies with the test
// frame. The single console.log line carries derived quota numbers only —
// never the token, never the AK/SK pair. If a live hop fails, the propagated
// error surfaces the vendor Code/Message and at most a bounded gateway body
// snippet (transport contract) — no credential material, by construction.
import { describe, expect, it } from 'vitest';
import type { Credential } from '../core/provider';
import { AllowlistNetworkClient } from '../network/client';
import { FetchTransport } from '../network/fetch-transport';
import {
  mintQuotaTokenRequest,
  parseMintResponse,
  parseTokenPlanUsage,
  tokenPlanUsageRequest,
} from '../providers/qwen-token-plan';

describe.runIf(process.env.QUOTADECK_LIVE === '1')('qwen live contract — publish gate', () => {
  it(
    'real builders + real acs3 signer + real allowlist client + real fetch against the live endpoints',
    async () => {
      const accessKeyId = process.env.QWEN_AK_ID;
      const accessKeySecret = process.env.QWEN_AK_SECRET;
      if (accessKeyId === undefined || accessKeySecret === undefined || accessKeyId === '' || accessKeySecret === '') {
        throw new Error(
          'QUOTADECK_LIVE=1 but QWEN_AK_ID/QWEN_AK_SECRET are not set in this process — ' +
            'run scripts/live-contract.ps1 (it extracts the stored pair into process env in memory) ' +
            'or export both variables yourself. Nothing was dispatched.',
        );
      }
      const credential: Credential = { type: 'ak-sk', accessKeyId, accessKeySecret };

      // Production construction (background.ts): the client over a FetchTransport
      // with the DEFAULT SystemClock + crypto.randomUUID() nonce — the same seam
      // startWorker uses, minus the worker itself.
      const client = new AllowlistNetworkClient(new FetchTransport());

      // Hop 1 — mint. The stored pair signs the query-less mint request at the
      // client's acs3 seam; the response carries the transient session token.
      const mintRequest = mintQuotaTokenRequest('international');
      expect(mintRequest).not.toBeNull();
      const mintResponse = await client.send('qwen', mintRequest!, credential);
      const sessionToken = parseMintResponse(mintResponse.body); // local only — never printed, never stored

      // Hop 2 — gateway usage. The token rides ONLY the session marker; the
      // client's placement scan is exercised exactly as in the live worker.
      const usageRequest = tokenPlanUsageRequest(sessionToken, 'international');
      expect(usageRequest).not.toBeNull();
      const usageResponse = await client.send('qwen', usageRequest!, credential);

      const result = parseTokenPlanUsage(usageResponse.body);

      // Quota-shape assertions — honest and drift-catching: percentage present
      // and finite in 0..1000 (the parser passes the USED fraction × 100
      // UNCAPPED, so tolerance goes past 100 but not to absurdity), and the
      // monthly reset must be in the FUTURE at dispatch time.
      expect(result.percentage).toBeDefined();
      expect(typeof result.percentage).toBe('number');
      expect(Number.isFinite(result.percentage)).toBe(true);
      expect(result.percentage).toBeGreaterThanOrEqual(0);
      expect(result.percentage).toBeLessThanOrEqual(1000);
      expect(Number.isFinite(result.resetAt)).toBe(true);
      expect(result.resetAt).toBeGreaterThan(Date.now());

      // ONE line of output: derived numbers only — no token, no credentials.
      console.log(JSON.stringify({ percentage: result.percentage, resetAtISO: new Date(result.resetAt!).toISOString() }));
    },
    30_000, // live network budget for both hops (worker ticks have no timeout; this is a gate, not a loop)
  );
});
