// @vitest-environment happy-dom
// Popup controller tests (popup-ui spec §Settings Gear Surface, §Per-Model
// Consumption View, §Current Cycle Data on Open, §Key Addition with
// Validation, §Masked Key Display, §Revocation from the Popup; AD-22/24) —
// AD-11: DOM flows need a real DOM to dispatch real events, so this file
// opts into happy-dom via the pragma. The suite runs with ZERO network
// doubles: the popup has no network path (structural import test below).
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

/** Fixed countdown clock — the popup's only time use is display rendering. */
const NOW_MS = 1_754_000_000_000;

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
  await new KeyStore(local).saveCredential(id, { type: 'bearer', token: credential } as const);
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
  startPopup({ browser: h.api, document, now: () => NOW_MS });
  await vi.waitFor(() => {
    expect(document.querySelector('#app h1')).not.toBeNull();
  });
}

/** The consumption view assembles per spec: cycle data + budget + one error. */
const LAST_CYCLE: CycleSnapshot = {
  results: {
    zai: {
      status: 'ok',
      usage: {
        providerId: 'zai',
        kind: 'cost',
        value: 39,
        currency: 'CNY',
        tier: 'Lite',
        budget: { used: 2400, limit: 2400, percent: 100, tier: 'Lite', resetAt: NOW_MS + 90 * 60_000 },
        fetchedAt: NOW_MS,
      },
    },
    qwen: { status: 'error', errorClass: 'auth' },
    openai: {
      status: 'ok',
      usage: {
        providerId: 'openai',
        kind: 'cost',
        value: 20,
        currency: 'usd',
        breakdown: [{ model: 'gpt-5.3', usageType: 'input_tokens', value: 20 }],
        fetchedAt: NOW_MS,
      },
    },
    kimi: {
      status: 'ok',
      usage: { providerId: 'kimi', kind: 'balance', value: 88.88, currency: 'CNY', fetchedAt: NOW_MS },
    },
  },
};

describe('controller — Current Cycle Data on Open, main view (popup-ui spec)', () => {
  it('opens on the main view: usage, ZAI budget block, tier, per-class error label', async () => {
    const h = makePopupHarness();
    await seedSnapshot(h.local, LAST_CYCLE);
    mountApp();

    await openPopup(h);

    const text = document.body.textContent ?? '';
    expect(text).toContain('¥39.00');
    expect(text).toContain('Budget: 100% of 2400 (2400 used)');
    expect(text).toContain('Resets in 1h 30m'); // countdown from the injected now
    expect(text).toContain('Tier: Lite');
    expect(text).toContain('$20.00');
    expect(text).toContain('¥88.88');
    expect(text).toContain('Auth failed'); // qwen error entry, per class (AD-21/22)
  });

  it('opens with an empty state per provider when no cycle has completed yet', async () => {
    const h = makePopupHarness();
    mountApp();

    await openPopup(h);

    const text = document.body.textContent ?? '';
    expect(text.match(/No cycle data yet/g)).toHaveLength(4);
  });

  it('the main view carries the gear and renders NO key forms (spec §Gear replaces inline key forms)', async () => {
    const h = makePopupHarness();
    mountApp();
    await openPopup(h);

    expect(document.querySelector('[data-action="open-settings"]')).not.toBeNull();
    expect(document.querySelector('#app form')).toBeNull();
    expect(document.querySelector('#app input')).toBeNull();
  });
});

describe('controller — Settings Gear Surface (popup-ui spec)', () => {
  it('the gear switches to settings and back — all key management lives inside the gear', async () => {
    const h = makePopupHarness();
    mountApp();
    await openPopup(h);

    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#app h1')?.textContent).toBe('Settings'));
    expect(document.querySelectorAll('#app form.key-form')).toHaveLength(4); // one per provider

    document.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#app h1')?.textContent).toBe('quotadeck'));
    expect(document.querySelector('#app form')).toBeNull();
  });

  it('a stored key shows masked inside settings only — never in the main view', async () => {
    const h = makePopupHarness();
    await seedKey(h.local, 'kimi', 'sk-test-1234567890abcdef');
    mountApp();
    await openPopup(h);

    expect(document.body.textContent).not.toContain('••••');

    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••cdef'));
    expect(document.body.textContent).not.toContain('sk-test-1234567890abcdef'); // full key never rendered
  });
});

describe('controller — Key Addition with Validation, inside the gear (popup-ui spec)', () => {
  async function openSettings(h: { api: BrowserApi }): Promise<void> {
    mountApp();
    await openPopup(h);
    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#app form.key-form')).not.toBeNull());
  }

  it('a valid openai key persists through the wrapper; input clears; masked state shows; full key absent from DOM', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    const key = 'sk-admin-abcdefgh1234';
    document.querySelector<HTMLInputElement>('#key-input-openai')!.value = key;
    document.querySelector<HTMLButtonElement>('#key-add-openai')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('••••1234'));
    expect(h.local.snapshot()[storageKey('openai')]).toBe(key); // persisted via the KeyStore wrapper
    expect(document.querySelector<HTMLInputElement>('#key-input-openai')!.value).toBe(''); // cleared on valid submit
    expect(document.documentElement.textContent ?? '').not.toContain(key); // full-key DOM sweep
  });

  it('a qwen AK/SK pair submits from TWO fields, stores one JSON pair, masks both parts', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    const accessKeyId = 'LTAI5tPopupAccessKey';
    const accessKeySecret = 'PopupPairSecret0000000000000';
    document.querySelector<HTMLInputElement>('#key-input-qwen-ak')!.value = accessKeyId;
    document.querySelector<HTMLInputElement>('#key-input-qwen-sk')!.value = accessKeySecret;
    document.querySelector<HTMLButtonElement>('#key-add-qwen')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('AccessKeyId: ••••sKey'));
    expect(h.local.snapshot()[storageKey('qwen')]).toEqual({ accessKeyId, accessKeySecret }); // one JSON pair (AD-17)
    expect(document.body.textContent).toContain('AccessKeySecret: ••••0000');
    expect(document.documentElement.textContent ?? '').not.toContain(accessKeySecret); // full pair never in DOM
    expect(document.querySelector<HTMLInputElement>('#key-input-qwen-ak')!.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('#key-input-qwen-sk')!.value).toBe('');
  });

  it('a DashScope sk- value in the qwen pair is rejected with the Alibaba guidance and nothing persists', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    document.querySelector<HTMLInputElement>('#key-input-qwen-ak')!.value = 'LTAI5tValidAccessKey';
    document.querySelector<HTMLInputElement>('#key-input-qwen-sk')!.value = 'sk-dashscope-abcdef123456';
    document.querySelector<HTMLButtonElement>('#key-add-qwen')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain(QWEN_AK_SK_GUIDANCE)); // rendered verbatim
    expect(h.local.snapshot()[storageKey('qwen')]).toBeUndefined();
    expect(document.querySelector<HTMLInputElement>('#key-input-qwen-sk')!.value).toBe('sk-dashscope-abcdef123456'); // keeps text — still editing (AD-15)
  });

  it('an empty input is rejected with guidance and nothing is persisted', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    document.querySelector<HTMLInputElement>('#key-input-openai')!.value = '';
    document.querySelector<HTMLButtonElement>('#key-add-openai')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('Credential must not be empty.'));
    expect(h.local.snapshot()[storageKey('openai')]).toBeUndefined();
  });

  it('a valid key clears a previously shown guidance message', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    document.querySelector<HTMLInputElement>('#key-input-kimi')!.value = '';
    document.querySelector<HTMLButtonElement>('#key-add-kimi')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Credential must not be empty.'));

    document.querySelector<HTMLInputElement>('#key-input-kimi')!.value = 'popup-milestone-key';
    document.querySelector<HTMLButtonElement>('#key-add-kimi')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••-key'));
    expect(document.body.textContent).not.toContain('Credential must not be empty.');
  });

  it('Enter on a credential input submits the form (keydown path, AD-24)', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    const key = 'sk-enter-key-abcdef99887766';
    const input = document.querySelector<HTMLInputElement>('#key-input-kimi')!;
    input.value = key;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(document.body.textContent).toContain('••••7766'));
    expect(h.local.snapshot()[storageKey('kimi')]).toBe(key);
    expect(document.documentElement.textContent ?? '').not.toContain(key);
  });

  it('Enter on a qwen pair input submits the pair from both fields', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    document.querySelector<HTMLInputElement>('#key-input-qwen-ak')!.value = 'LTAI5tEnterAccessKeyId';
    const sk = document.querySelector<HTMLInputElement>('#key-input-qwen-sk')!;
    sk.value = 'EnterPairSecret00000000000000000';
    sk.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(document.body.textContent).toContain('AccessKeyId: ••••eyId'));
    expect(h.local.snapshot()[storageKey('qwen')]).toEqual({
      accessKeyId: 'LTAI5tEnterAccessKeyId',
      accessKeySecret: 'EnterPairSecret00000000000000000',
    });
  });
});

describe('controller — Revocation from the Popup (popup-ui spec)', () => {
  async function openSettingsWith(
    h: { api: BrowserApi; local: FakeStorageArea },
    seeds: ReadonlyArray<[ProviderId, string]>,
  ): Promise<void> {
    for (const [id, credential] of seeds) {
      await seedKey(h.local, id, credential);
    }
    mountApp();
    await openPopup(h);
    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#app form.key-form')).not.toBeNull());
  }

  it('revoking kimi removes its stored key and the settings view reflects the absence', async () => {
    const h = makePopupHarness();
    await openSettingsWith(h, [['kimi', 'sk-kimi-bbbb2222']]);
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••2222'));

    document.querySelector<HTMLButtonElement>('#key-revoke-kimi')!.click();

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('••••2222'));
    expect(h.local.snapshot()[storageKey('kimi')]).toBeUndefined();
  });

  it('revoking zai leaves kimi stored and displayed (isolation per key-storage)', async () => {
    const h = makePopupHarness();
    await openSettingsWith(h, [
      ['zai', 'sk-zai-aaaa1111'],
      ['kimi', 'sk-kimi-bbbb2222'],
    ]);
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••2222'));

    document.querySelector<HTMLButtonElement>('#key-revoke-zai')!.click();

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('••••1111'));
    expect(document.body.textContent).toContain('••••2222');
    expect(h.local.snapshot()[storageKey('kimi')]).toBe('sk-kimi-bbbb2222');
  });
});

describe('controller — import boundary (AD-24)', () => {
  it('popup sources import no network, fixture or provider module — no network path by construction', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(dir).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0); // the guard actually scans files
    for (const file of sources) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, `${file} must not import network, fixtures or providers`).not.toMatch(
        /from\s+'\.\.\/(network|fixtures|providers)/,
      );
    }
  });

  it('the controller takes provider metadata from PROVIDER_METADATA, not the provider registry', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'controller.ts'), 'utf8');
    expect(source).toContain("from '../core/provider-metadata'");
    expect(source).not.toMatch(/from\s+'\.\.\/providers/); // no provider classes → no dead endpoint URLs
  });
});
