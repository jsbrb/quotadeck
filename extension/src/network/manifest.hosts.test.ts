import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'vitest';
import { SHIPPED_PROVIDER_IDS } from '../core/provider-metadata';
import { PROVIDER_ALLOWLIST } from './allowlist';

// AD-16 (supersedes AD-7), hito-10 shipping filter: manifest host_permissions
// is pinned to the exact allowlist union FILTERED TO SHIPPED_PROVIDER_IDS.
// Same pattern as allowlist.source.test.ts: the expected set is DERIVED from
// PROVIDER_ALLOWLIST and deep-strict-equals the shipped manifest — an extra
// or missing host fails the build. The FULL allowlist stays single-sourced by
// docs/spike/endpoints.md (allowlist.source.test.ts untouched); only the
// shipped slice reaches the manifest.
const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../public/manifest.json',
);

/** `https://{host}/*` pattern per shipped-provider allowlisted host, sorted for determinism. */
function expectedHostPatterns(): string[] {
  const hosts = new Set<string>();
  for (const id of SHIPPED_PROVIDER_IDS) {
    for (const host of PROVIDER_ALLOWLIST[id].hosts) {
      hosts.add(host);
    }
  }
  return [...hosts].map((host) => `https://${host}/*`).sort();
}

describe('manifest host_permissions sync (AD-16, hito-10 shipped filter)', () => {
  it('host_permissions deep-strict-equals the PROVIDER_ALLOWLIST union filtered to SHIPPED_PROVIDER_IDS', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      host_permissions?: string[];
    };
    deepStrictEqual(manifest.host_permissions, expectedHostPatterns());
  });

  it('pins the exact shipped host patterns (zai + qwen + deepseek: the three shipped providers)', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      host_permissions?: string[];
    };
    deepStrictEqual(manifest.host_permissions, [
      'https://api.deepseek.com/*',
      'https://api.z.ai/*',
      'https://bailian-singapore-cs.alibabacloud.com/*',
      'https://business.aliyuncs.com/*',
      'https://business.ap-southeast-1.aliyuncs.com/*',
      'https://modelstudio.ap-southeast-1.aliyuncs.com/*',
      'https://open.bigmodel.cn/*',
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com/*',
    ]);
  });
});
