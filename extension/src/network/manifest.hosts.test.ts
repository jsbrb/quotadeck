import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'vitest';
import { PROVIDER_ALLOWLIST } from './allowlist';

// AD-16 (supersedes AD-7): manifest host_permissions is pinned to the exact
// allowlist union. Same pattern as allowlist.source.test.ts: the expected set
// is DERIVED from PROVIDER_ALLOWLIST and deep-strict-equals the shipped
// manifest — an extra or missing host fails the build (spec §Manifest Host
// Permissions Consistency, scenarios "equals allowlist" + "extra host fails").
const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../public/manifest.json',
);

/** `https://{host}/*` pattern per allowlisted host, sorted for determinism. */
function expectedHostPatterns(): string[] {
  const hosts = new Set<string>();
  for (const entry of Object.values(PROVIDER_ALLOWLIST)) {
    for (const host of entry.hosts) {
      hosts.add(host);
    }
  }
  return [...hosts].map((host) => `https://${host}/*`).sort();
}

describe('manifest host_permissions sync (AD-16)', () => {
  it('host_permissions deep-strict-equals the PROVIDER_ALLOWLIST union', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      host_permissions?: string[];
    };
    deepStrictEqual(manifest.host_permissions, expectedHostPatterns());
  });

  it('pins the exact four shipped host patterns', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      host_permissions?: string[];
    };
    deepStrictEqual(manifest.host_permissions, [
      'https://api.moonshot.cn/*',
      'https://api.openai.com/*',
      'https://bigmodel.cn/*',
      'https://business.aliyuncs.com/*',
    ]);
  });
});
