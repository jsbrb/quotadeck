// Copy contract tests (AD-24) — the live milestone ships honest copy: the
// "fixture-only milestone" language is gone from every shipped artifact, the
// manifest description announces live provider usage, and the README explains
// the live security posture including the host_permissions rationale.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(here, relative), 'utf8');

describe('milestone copy (AD-24)', () => {
  it('the manifest description announces live provider usage', () => {
    const manifest = JSON.parse(read('../public/manifest.json')) as { description: string };
    expect(manifest.description).toBe('Provider usage and balance badge');
  });

  it('no shipped artifact still calls the milestone fixture-only', () => {
    for (const [label, source] of [
      ['README', read('../../README.md')],
      ['manifest', read('../public/manifest.json')],
      ['package.json', read('../package.json')],
    ] as const) {
      expect(source, `${label} must not claim fixture-only operation`).not.toMatch(/fixture-only/i);
    }
  });

  it('the README documents the live posture: host_permissions rationale, settings gear, error states', () => {
    const readme = read('../../README.md');
    expect(readme).toContain('host_permissions');
    expect(readme).toContain('Settings'); // gear-driven key management
    expect(readme).toMatch(/ERR/); // bad keys surface as an error state, honestly stated
  });
});
