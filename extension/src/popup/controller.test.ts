// @vitest-environment happy-dom
// Popup controller tests (popup-ui spec §Current Cycle Data on Open,
// §Key Addition with Validation, §Masked Key Display, §Revocation from the
// Popup, §Fixture-Only Operation) — AD-11: DOM flows need a real DOM to
// dispatch real events, so this file opts into happy-dom via the pragma.
// The suite runs with ZERO network doubles: the popup has no network path.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { QWEN_AK_SK_GUIDANCE } from '../core/credentials';
import type { ProviderId } from '../core/provider';
import type { BrowserApi } from '../platform/browser-api';
import { KEY_STORAGE_PREFIX, KeyStore } from '../storage/key-store';
import { type CycleSnapshot, SnapshotStore } from '../storage/snapshot-store';
import { FakeBrowser, type FakeStorageArea } from '../testing/fake-browser';
import { startPopup } from './controller';

const storageKey = (id: ProviderId): string => `${KEY_STORAGE_PREFIX}${id}`;

/** BrowserApi-shaped harness over FakeBrowser parts (same pattern as background.test.ts). */
function makePopupHarness(): { api: BrowserApi; local: FakeStorageArea } {
  const base = new FakeBrowser();
  const api: BrowserApi = {
    storage: base.storage,
    alarms: base.alarms,
    action: base.action,
    runtime: {
      onInstalled: { listen: () => undefined },
      onStartup: { listen: () => undefined },
    },
  };
  return { api, local: base.local };
}

async function seedKey(local: FakeStorageArea, id: ProviderId, credential: string): Promise<void> {
  await new KeyStore(local).saveKey(id, credential);
}

async function seedSnapshot(local: FakeStorageArea, snapshot: CycleSnapshot): Promise<void> {
  await new SnapshotStore(local).write(snapshot);
}

/** Replaces the page body with the static popup shell, like popup.html does. */
function mountApp(): void {
  document.body.innerHTML = '<main id="app"></main>';
}

/** startPopup renders asynchronously; wait until the shell is populated. */
async function openPopup(h: { api: BrowserApi }): Promise<void> {
  startPopup({ browser: h.api, document });
  await vi.waitFor(() => {
    expect(document.querySelector('#app h1')).not.toBeNull();
  });
}

/** A completed four-provider cycle mirroring the fixture badge cycle. */
const LAST_CYCLE: CycleSnapshot = {
  results: {
    zai: {
      status: 'ok',
      usage: { providerId: 'zai', kind: 'cost', value: 39, currency: 'CNY', tier: 'GLM-4.5-Air', fetchedAt: 1_754_000_000_000 },
    },
    qwen: { status: 'error', errorClass: 'auth' },
    openai: {
      status: 'ok',
      usage: { providerId: 'openai', kind: 'cost', value: 20, currency: 'usd', fetchedAt: 1_754_000_000_000 },
    },
    kimi: {
      status: 'ok',
      usage: { providerId: 'kimi', kind: 'balance', value: 88.88, currency: 'CNY', fetchedAt: 1_754_000_000_000 },
    },
  },
};

describe('controller — Current Cycle Data on Open (popup-ui spec)', () => {
  it('open renders the last completed cycle: usage+tier per ok provider, error for the failed one', async () => {
    const h = makePopupHarness();
    await seedSnapshot(h.local, LAST_CYCLE);
    mountApp();

    await openPopup(h);

    const text = document.body.textContent ?? '';
    expect(text).toContain('¥39.00');
    expect(text).toContain('Tier: GLM-4.5-Air');
    expect(text).toContain('$20.00');
    expect(text).toContain('¥88.88');
    expect(text).toContain('Refresh failed');
  });

  it('opens with an empty state per provider when no cycle has completed yet', async () => {
    const h = makePopupHarness();
    mountApp();

    await openPopup(h);

    const text = document.body.textContent ?? '';
    expect(text.match(/No cycle data yet/g)).toHaveLength(4);
  });
});

describe('controller — Key Addition with Validation (popup-ui spec)', () => {
  it('a valid openai key persists through the wrapper; input clears; masked state shows; full key absent from DOM', async () => {
    const h = makePopupHarness();
    mountApp();
    await openPopup(h);

    const key = 'sk-admin-abcdefgh1234';
    document.querySelector<HTMLInputElement>('#key-input-openai')!.value = key;
    document.querySelector<HTMLButtonElement>('#key-add-openai')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('••••1234'));
    expect(h.local.snapshot()[storageKey('openai')]).toBe(key); // persisted via the KeyStore wrapper
    expect(document.querySelector<HTMLInputElement>('#key-input-openai')!.value).toBe(''); // cleared on valid submit
    expect(document.documentElement.textContent ?? '').not.toContain(key); // full-key DOM sweep
  });

  it('an empty input is rejected with guidance and nothing is persisted', async () => {
    const h = makePopupHarness();
    mountApp();
    await openPopup(h);

    document.querySelector<HTMLInputElement>('#key-input-openai')!.value = '';
    document.querySelector<HTMLButtonElement>('#key-add-openai')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('Credential must not be empty.'));
    expect(h.local.snapshot()[storageKey('openai')]).toBeUndefined();
  });

  it('a Qwen DashScope sk- key is rejected with the Alibaba AK/SK guidance and nothing persists', async () => {
    const h = makePopupHarness();
    mountApp();
    await openPopup(h);

    const key = 'sk-dashscope-abcdef123456';
    const input = document.querySelector<HTMLInputElement>('#key-input-qwen')!;
    input.value = key;
    document.querySelector<HTMLButtonElement>('#key-add-qwen')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('bss:DescribeAcccount'));
    expect(document.body.textContent).toContain(QWEN_AK_SK_GUIDANCE); // rendered verbatim from validateCredential
    expect(h.local.snapshot()[storageKey('qwen')]).toBeUndefined();
    expect(document.documentElement.textContent ?? '').not.toContain(key); // full key never leaves the input
    expect(input.value).toBe(key); // invalid input keeps the text — the user is still editing (AD-15)
  });

  it('a valid key clears a previously shown guidance message', async () => {
    const h = makePopupHarness();
    mountApp();
    await openPopup(h);

    document.querySelector<HTMLInputElement>('#key-input-kimi')!.value = '';
    document.querySelector<HTMLButtonElement>('#key-add-kimi')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Credential must not be empty.'));

    document.querySelector<HTMLInputElement>('#key-input-kimi')!.value = 'fixture-milestone-key';
    document.querySelector<HTMLButtonElement>('#key-add-kimi')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••-key'));
    expect(document.body.textContent).not.toContain('Credential must not be empty.');
  });
});

describe('controller — Masked Key Display (popup-ui spec)', () => {
  it('a stored key renders masked — at most a 4-character suffix, never the full key', async () => {
    const h = makePopupHarness();
    const key = 'sk-test-1234567890abcdef';
    await seedKey(h.local, 'kimi', key);
    await seedSnapshot(h.local, LAST_CYCLE);
    mountApp();

    await openPopup(h);

    const text = document.body.textContent ?? '';
    expect(text).toContain('••••cdef');
    expect(text).not.toContain(key);
  });
});

describe('controller — Revocation from the Popup (popup-ui spec)', () => {
  it('revoking kimi removes its stored key and the popup reflects the absence', async () => {
    const h = makePopupHarness();
    await seedKey(h.local, 'kimi', 'sk-kimi-bbbb2222');
    mountApp();

    await openPopup(h);
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••2222'));

    document.querySelector<HTMLButtonElement>('#key-revoke-kimi')!.click();

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('••••'));
    expect(h.local.snapshot()[storageKey('kimi')]).toBeUndefined();
  });

  it('revoking zai leaves kimi stored and displayed (isolation per key-storage)', async () => {
    const h = makePopupHarness();
    await seedKey(h.local, 'zai', 'sk-zai-aaaa1111');
    await seedKey(h.local, 'kimi', 'sk-kimi-bbbb2222');
    mountApp();

    await openPopup(h);
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••2222'));

    document.querySelector<HTMLButtonElement>('#key-revoke-zai')!.click();

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('••••1111'));
    expect(document.body.textContent).toContain('••••2222');
    expect(h.local.snapshot()[storageKey('kimi')]).toBe('sk-kimi-bbbb2222');
  });
});

describe('controller — Fixture-Only Operation (popup-ui spec)', () => {
  it('popup sources import no network or fixture module — no network path by construction', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(dir).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0); // the guard actually scans files
    for (const file of sources) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, `${file} must not import network or fixtures`).not.toMatch(/from\s+'\.\.\/(network|fixtures)/);
    }
  });
});
