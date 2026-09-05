// Test-only refresh driver: the minimal pagination loop that the Phase-5
// RefreshEngine will own (AD-2). NEVER imported by production code — testing
// doubles only (AD-1). It dispatches through the real AllowlistNetworkClient
// (so host admission + Authorization-only credentials stay proven) against a
// RecordingTransport, draws the declared inter-page delay window from the
// injected Clock (deterministic via the `rng` seam), and stamps `fetchedAt`.
import type { Clock } from '../core/clock';
import type { Credential, CredentialType, Provider, UsageQuery } from '../core/provider';
import type { NormalizedUsage } from '../core/usage';
import type { AllowlistNetworkClient } from '../network/client';

/** Typed test credentials per CredentialType; never appear in any request surface they do not belong to. */
export const TEST_CREDENTIALS: Readonly<Record<CredentialType, Credential>> = {
  bearer: { type: 'bearer', token: 'test-driver-credential' },
  'openai-admin-read': { type: 'openai-admin-read', token: 'test-driver-credential' },
  raw: { type: 'raw', token: 'test-driver-credential' },
  'ak-sk': {
    type: 'ak-sk',
    accessKeyId: 'LTAI5tTestDriverAK000',
    accessKeySecret: 'TestDriverSecret0000000000000000',
  },
};

export async function driveRefresh(
  provider: Provider,
  query: UsageQuery,
  client: AllowlistNetworkClient,
  clock: Clock,
  rng: () => number = Math.random,
): Promise<NormalizedUsage> {
  const credential = TEST_CREDENTIALS[provider.credentialType];
  let parse = provider.parsePage(
    (await client.send(provider.id, provider.firstRequest(query), credential)).body,
    null,
  );
  while (!parse.done) {
    if (provider.interPageDelayMs !== undefined) {
      const [min, max] = provider.interPageDelayMs;
      await clock.sleep(Math.round(min + rng() * (max - min)));
    }
    parse = provider.parsePage(
      (await client.send(provider.id, parse.next, credential)).body,
      parse.state,
    );
  }
  // Providers emit fetchedAt 0; the engine stamps the fold time from the Clock.
  return { ...parse.usage, fetchedAt: clock.now() };
}
