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
    // Store listing copy (hito-10): GLM Coding Plan usage, verbatim from the manifest.
    expect(manifest.description).toBe(
      'Track your GLM Coding Plan usage live — 5-hour and weekly token windows, MCP quota and balance in one toolbar badge.',
    );
  });

  it('declares the minimum Chrome version the badge color APIs require (review R3-1)', () => {
    const manifest = JSON.parse(read('../public/manifest.json')) as { minimum_chrome_version?: string };
    // setBadgeTextColor ships in Chrome 110 (hito-10); the manifest must gate
    // older installs instead of throwing inside every success tick.
    expect(manifest.minimum_chrome_version).toBe('110');
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

  it('the README documents the ZAI monitor surface: windows, MCP, selector, raw auth (AD-26/28)', () => {
    const readme = read('../../README.md');
    expect(readme).toContain('monitor'); // the monitor endpoint is the stated ZAI surface
    expect(readme).toContain('5h'); // the 5h window language
    expect(readme).toContain('MCP'); // the monthly MCP window
    expect(readme).toContain('ZHIPU'); // the platform selector
    expect(readme).toContain('api.z.ai'); // monitor hosts named
    expect(readme).toContain('open.bigmodel.cn');
    expect(readme).toContain('two shipped hosts'); // hito-10: host_permissions is the allowlist filtered to SHIPPED_PROVIDER_IDS
    expect(readme).toMatch(/raw key|verbatim/i); // raw-auth note: no Bearer on monitor hosts
  });
});
