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

  it('pins: ZAI allowlists exactly the two monitor hosts; the apex bigmodel.cn is absent (AD-29)', () => {
    deepStrictEqual(PROVIDER_ALLOWLIST.zai.hosts, ['api.z.ai', 'open.bigmodel.cn']);
    strictEqual(
      PROVIDER_ALLOWLIST.zai.hosts.includes('bigmodel.cn'),
      false,
      'the apex bigmodel.cn grant retired with expenseBillList — a permission grant with no caller violates least privilege',
    );
  });

  it('pins: qwen allowlists exactly the two BSS hosts, the token-plan probe host and the live-verified token-plan quota gateway (hito-8 + hito-12)', () => {
    deepStrictEqual(PROVIDER_ALLOWLIST.qwen.hosts, [
      'business.aliyuncs.com',
      'business.ap-southeast-1.aliyuncs.com',
      'token-plan.ap-southeast-1.maas.aliyuncs.com',
      'bailian-singapore-cs.alibabacloud.com',
    ]);
  });
});

describe('isHostAllowed suffix matching (AD-5, re-pinned to the monitor hosts)', () => {
  it('admits both monitor hosts and subdomains of an allowlisted pattern', () => {
    strictEqual(isHostAllowed('zai', 'api.z.ai'), true);
    strictEqual(isHostAllowed('zai', 'open.bigmodel.cn'), true);
    strictEqual(isHostAllowed('zai', 'edge.api.z.ai'), true); // subdomain of a pattern
    strictEqual(isHostAllowed('openai', 'api.openai.com'), true);
  });

  it('rejects the retired apex and lookalikes', () => {
    strictEqual(isHostAllowed('zai', 'bigmodel.cn'), false); // apex retired (AD-29)
    strictEqual(isHostAllowed('zai', 'evil.example.com'), false);
    strictEqual(isHostAllowed('zai', 'notbigmodel.cn'), false);
    strictEqual(isHostAllowed('zai', 'api.z.ai.evil.com'), false);
  });

  it('is scoped per provider: another provider’s host is not admitted', () => {
    strictEqual(isHostAllowed('zai', 'api.moonshot.cn'), false);
    strictEqual(isHostAllowed('kimi', 'open.bigmodel.cn'), false); // cross-provider monitor host
  });
});
