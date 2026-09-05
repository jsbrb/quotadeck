import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'vitest';
import { isHostAllowed, PROVIDER_ALLOWLIST } from './allowlist';

// AD-4: docs/spike/endpoints.md is the single source of truth for the
// allowlist. This suite parses the doc's fenced json block and deep-strict-
// equals it against the typed code constant, so drift fails the build.
const DOC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/spike/endpoints.md',
);

function extractAllowlistBlock(doc: string): string {
  const blocks = [...doc.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  strictEqual(
    blocks.length,
    1,
    `expected exactly one json block in ${DOC_PATH}, found ${blocks.length}`,
  );
  return blocks[0]!;
}

describe('allowlist single-source sync (AD-4)', () => {
  it('the doc json block deep-strict-equals PROVIDER_ALLOWLIST', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    const parsed = JSON.parse(extractAllowlistBlock(doc));
    deepStrictEqual(parsed, PROVIDER_ALLOWLIST);
  });

  it('pins: ZAI allowlists bigmodel.cn and NOT the unverified api.z.ai', () => {
    strictEqual(PROVIDER_ALLOWLIST.zai.hosts.includes('bigmodel.cn'), true);
    strictEqual(
      PROVIDER_ALLOWLIST.zai.hosts.includes('api.z.ai'),
      false,
      'api.z.ai is unverified and must not appear on the ZAI allowlist (spec §Unverified Variant Excluded)',
    );
  });
});

describe('isHostAllowed suffix matching (AD-5)', () => {
  it('admits the exact host and any subdomain of an allowlisted pattern', () => {
    strictEqual(isHostAllowed('zai', 'bigmodel.cn'), true);
    strictEqual(isHostAllowed('zai', 'open.bigmodel.cn'), true);
    strictEqual(isHostAllowed('openai', 'api.openai.com'), true);
  });

  it('rejects lookalikes and unrelated hosts', () => {
    strictEqual(isHostAllowed('zai', 'evil.example.com'), false);
    strictEqual(isHostAllowed('zai', 'notbigmodel.cn'), false);
    strictEqual(isHostAllowed('zai', 'bigmodel.cn.evil.com'), false);
  });

  it('is scoped per provider: another provider’s host is not admitted', () => {
    strictEqual(isHostAllowed('zai', 'api.moonshot.cn'), false);
    strictEqual(isHostAllowed('kimi', 'bigmodel.cn'), false);
  });
});
