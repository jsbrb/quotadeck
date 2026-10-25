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
import { QWEN_AK_SK_GUIDANCE, QWEN_PLAN_KEY_GUIDANCE } from '../core/credentials';
import type { Credential, ProviderId } from '../core/provider';
import type { BrowserApi } from '../platform/browser-api';
import { KEY_STORAGE_PREFIX, KeyStore } from '../storage/key-store';
import { BADGE_PROVIDER_STORAGE_KEY } from '../storage/badge-provider-store';
import { QWEN_SITE_STORAGE_KEY } from '../storage/qwen-site-store';
import { ZAI_PLATFORM_STORAGE_KEY } from '../storage/zai-platform-store';
import { type CycleSnapshot, SNAPSHOT_STORAGE_KEY } from '../storage/snapshot-store';
import { FakeBrowser, type FakeStorageArea } from '../testing/fake-browser';
import { startPopup } from './controller';
import { ZAI_WRONG_PLATFORM_GUIDANCE } from './view';

const storageKey = (id: ProviderId): string => `${KEY_STORAGE_PREFIX}${id}`;

/** Fixed countdown clock — the popup's only time use is display rendering. */
const NOW_MS = 1_754_000_000_000;

/** BrowserApi-shaped harness over FakeBrowser parts (same pattern as background.test.ts). */
function makePopupHarness(): { api: BrowserApi; local: FakeStorageArea; browser: FakeBrowser } {
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
  return { api, local: base.local, browser: base };
}

/** One valid credential per provider, each in its provider's credential shape. */
const PROVIDER_CREDENTIALS: Readonly<Record<ProviderId, Credential>> = {
  zai: { type: 'raw', token: 'sk-zai-cccc3333' },
  qwen: { type: 'ak-sk', accessKeyId: 'LTAI5tPopupAccessKey', accessKeySecret: 'PopupPairSecret0000000000000' },
  openai: { type: 'openai-admin-read', token: 'sk-admin-abcdefgh1234' },
  kimi: { type: 'bearer', token: 'sk-kimi-bbbb2222' },
};

/** Seeds every provider credential — the shipped-subset filter then keeps the zai and qwen cards (hito-12). */
async function seedAllKeys(local: FakeStorageArea): Promise<void> {
  const keys = new KeyStore(local);
  for (const [id, credential] of Object.entries(PROVIDER_CREDENTIALS) as Array<[ProviderId, Credential]>) {
    await keys.saveCredential(id, credential);
  }
}

/** Seeds one raw ZAI credential (a shipped slot). */
async function seedZaiKey(local: FakeStorageArea, token: string): Promise<void> {
  await new KeyStore(local).saveCredential('zai', { type: 'raw', token } as const);
}

async function seedSnapshot(local: FakeStorageArea, snapshot: CycleSnapshot): Promise<void> {
  // Raw area write, not SnapshotStore.write: since hito-11 the store's
  // lastKnown merge performs an extra internal read, and the re-read-count
  // pins below must attribute reads to the popup only.
  await local.set({ [SNAPSHOT_STORAGE_KEY]: snapshot });
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

/** The consumption view assembles per spec: cycle data + monitor block + one error. */
const LAST_CYCLE: CycleSnapshot = {
  results: {
    zai: {
      status: 'ok',
      usage: {
        providerId: 'zai',
        kind: 'cost',
        windows: {
          level: 'Pro',
          fiveHour: { percentage: 137, used: 16_440, total: 12_000, resetAt: NOW_MS + 90 * 60_000 },
          weekly: { percentage: 42, used: 5_040, total: 12_000 },
          mcp: {
            used: 3,
            ceiling: 60,
            tools: [
              { name: 'web-search', used: 2 },
              { name: 'code-execution', used: 1 },
            ],
          },
        },
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
  it('opens on the main view: usage, ZAI monitor block — and ONLY the shipped zai + qwen cards (hito-12 re-ship)', async () => {
    const h = makePopupHarness();
    await seedSnapshot(h.local, LAST_CYCLE);
    await seedAllKeys(h.local); // hito-6: cards render for keyed providers only
    mountApp();

    await openPopup(h);

    const text = document.body.textContent ?? '';
    expect(text).toContain('Level: Pro');
    expect(text).toContain('5h: 16440 / 12000 · Resets in 1h 30m'); // countdown from the injected now
    expect(document.querySelector('.hero-percentage')?.textContent).toBe('137%'); // dual hero (hito-6)
    expect(text).toContain('Weekly: 42% · 5040 / 12000');
    expect(text).toContain('MCP: 3 / 60');
    // Shipped-subset pin (hito-12): qwen re-ships and renders its card;
    // stored keys for openai/kimi still never render — the card list is the
    // shipped subset, not the keyed set.
    expect(text).toContain('Auth failed'); // qwen error entry, per class (AD-21/22)
    expect(text).toContain('Qwen (Alibaba Cloud BSS)'); // qwen re-shipped on this branch
    expect(text).not.toContain('$20.00'); // openai unshipped
    expect(text).not.toContain('¥88.88'); // kimi unshipped
    expect(text).not.toContain('OpenAI');
    expect(text).not.toContain('Kimi (Moonshot AI)');
  });

  it('the qwen card renders the token-plan quota line from the snapshot with a display-time countdown (hito-12 WU-D3)', async () => {
    const h = makePopupHarness();
    await seedSnapshot(h.local, {
      results: {
        qwen: {
          status: 'ok',
          usage: {
            providerId: 'qwen',
            kind: 'balance',
            value: 100.28,
            currency: 'CNY',
            quota: { percentage: 11.72, resetAt: NOW_MS + 90 * 60_000, fetchedAt: NOW_MS },
            fetchedAt: NOW_MS,
          },
        },
      },
    });
    await seedAllKeys(h.local);
    mountApp();
    await openPopup(h);

    const qwen = document.querySelector('section[data-provider="qwen"]');
    expect(qwen?.textContent).toContain('Token Plan: 11.7% used · resets in 1h 30m'); // countdown from the injected now
    expect(qwen?.textContent).toContain('¥100.28');
  });

  it('opens with an empty state per KEYED SHIPPED provider when no cycle has completed yet', async () => {
    const h = makePopupHarness();
    await seedAllKeys(h.local); // keyed, no snapshot → one "No cycle data yet" card per shipped provider (hito-12)
    mountApp();

    await openPopup(h);

    const text = document.body.textContent ?? '';
    expect(text.match(/No cycle data yet/g)).toHaveLength(2); // zai + qwen; openai/kimi stay unshipped
  });

  it('keyless providers render no card at all on open — the noise card is gone (hito-6)', async () => {
    const h = makePopupHarness();
    await seedSnapshot(h.local, LAST_CYCLE); // cycle data exists for everyone…
    mountApp();

    await openPopup(h); // …but NO provider is keyed

    expect(document.body.textContent ?? '').not.toContain('No cycle data yet');
    expect(document.querySelector('#app section.provider')).toBeNull();
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
    // One form per SHIPPED provider plus the qwen plan-key group (hito-12
    // re-ship): zai, the qwen AK/SK pair, and the qwen plan group — openai
    // and kimi ride the unshipped list.
    expect([...document.querySelectorAll('#app form.key-form')].map((form) => form.getAttribute('data-provider'))).toEqual([
      'zai',
      'qwen',
      'qwen-plan',
    ]);

    document.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#app h1')?.textContent).toBe('quotadeck'));
    expect(document.querySelector('#app form')).toBeNull();
  });

  it('a stored key shows masked inside settings only — never in the main view', async () => {
    const h = makePopupHarness();
    await seedZaiKey(h.local, 'sk-zai-cccc3333');
    mountApp();
    await openPopup(h);

    expect(document.body.textContent).not.toContain('••••');

    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••3333'));
    expect(document.body.textContent).not.toContain('sk-zai-cccc3333'); // full key never rendered
  });
});

describe('controller — Key Addition with Validation, inside the gear (popup-ui spec)', () => {
  async function openSettings(h: { api: BrowserApi }): Promise<void> {
    mountApp();
    await openPopup(h);
    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#app form.key-form')).not.toBeNull());
  }

  it('a valid zai key persists through the wrapper; input clears; masked state shows; full key absent from DOM', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    const key = 'sk-zai-valid-abcdefgh1234';
    document.querySelector<HTMLInputElement>('#key-input-zai')!.value = key;
    document.querySelector<HTMLButtonElement>('#key-add-zai')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('••••1234'));
    expect(h.local.snapshot()[storageKey('zai')]).toBe(key); // persisted via the KeyStore wrapper
    expect(document.querySelector<HTMLInputElement>('#key-input-zai')!.value).toBe(''); // cleared on valid submit
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

    document.querySelector<HTMLInputElement>('#key-input-zai')!.value = '';
    document.querySelector<HTMLButtonElement>('#key-add-zai')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('Credential must not be empty.'));
    expect(h.local.snapshot()[storageKey('zai')]).toBeUndefined();
  });

  it('a valid key clears a previously shown guidance message', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    document.querySelector<HTMLInputElement>('#key-input-zai')!.value = '';
    document.querySelector<HTMLButtonElement>('#key-add-zai')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Credential must not be empty.'));

    document.querySelector<HTMLInputElement>('#key-input-zai')!.value = 'popup-milestone-key';
    document.querySelector<HTMLButtonElement>('#key-add-zai')!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••-key'));
    expect(document.body.textContent).not.toContain('Credential must not be empty.');
  });

  it('Enter on a credential input submits the form (keydown path, AD-24)', async () => {
    const h = makePopupHarness();
    await openSettings(h);

    const key = 'sk-enter-key-abcdef99887766';
    const input = document.querySelector<HTMLInputElement>('#key-input-zai')!;
    input.value = key;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(document.body.textContent).toContain('••••7766'));
    expect(h.local.snapshot()[storageKey('zai')]).toBe(key);
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

describe('controller — ZAI Platform Selector (popup-ui spec §ZAI Platform Selector; AD-28)', () => {
  async function openSettingsView(h: { api: BrowserApi }): Promise<void> {
    mountApp();
    await openPopup(h);
    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#zai-platform-select')).not.toBeNull());
  }

  it('defaults to Z.AI with the unmasked label when no preference is stored', async () => {
    const h = makePopupHarness();
    await openSettingsView(h);

    const select = document.querySelector<HTMLSelectElement>('#zai-platform-select')!;
    expect(select.value).toBe('zai');
    expect(select.selectedOptions[0]!.textContent).toBe('Z.AI'); // label rendered unmasked
  });

  it('selecting ZHIPU persists the preference and re-renders the selector on it', async () => {
    const h = makePopupHarness();
    await openSettingsView(h);

    const select = document.querySelector<HTMLSelectElement>('#zai-platform-select')!;
    select.value = 'zhipu';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(h.local.snapshot()[ZAI_PLATFORM_STORAGE_KEY]).toBe('zhipu'));
    const reRendered = document.querySelector<HTMLSelectElement>('#zai-platform-select')!;
    expect(reRendered.value).toBe('zhipu'); // the re-render reflects the persisted platform
  });

  it('reads the stored preference on load — ZHIPU shows selected after reopening the popup', async () => {
    const h = makePopupHarness();
    await h.local.set({ [ZAI_PLATFORM_STORAGE_KEY]: 'zhipu' });
    await openSettingsView(h);

    expect(document.querySelector<HTMLSelectElement>('#zai-platform-select')!.value).toBe('zhipu');
  });

  it('an invalid stored preference defaults the selector to Z.AI (read-on-load contract)', async () => {
    const h = makePopupHarness();
    await h.local.set({ [ZAI_PLATFORM_STORAGE_KEY]: 'bigmodel' });
    await openSettingsView(h);

    expect(document.querySelector<HTMLSelectElement>('#zai-platform-select')!.value).toBe('zai');
  });

  it('a platform switch never touches the credential namespace', async () => {
    const h = makePopupHarness();
    await seedZaiKey(h.local, 'sk-zai-isolated-9999');
    await openSettingsView(h);

    const select = document.querySelector<HTMLSelectElement>('#zai-platform-select')!;
    select.value = 'zhipu';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(h.local.snapshot()[ZAI_PLATFORM_STORAGE_KEY]).toBe('zhipu'));

    expect(h.local.snapshot()[storageKey('zai')]).toBe('sk-zai-isolated-9999'); // keys untouched
    expect(document.body.textContent).toContain('••••9999'); // masked state intact
  });
});

describe('controller — Qwen Site Selector (popup-ui spec §Qwen Site Selector)', () => {
  async function openSettingsView(h: { api: BrowserApi }): Promise<void> {
    mountApp();
    await openPopup(h);
    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#qwen-site-select')).not.toBeNull());
  }

  it('defaults to International with the unmasked default-marking label when no preference is stored', async () => {
    const h = makePopupHarness();
    await openSettingsView(h);

    const select = document.querySelector<HTMLSelectElement>('#qwen-site-select')!;
    expect(select.value).toBe('international');
    expect(select.selectedOptions[0]!.textContent).toBe('International (default)'); // label rendered unmasked
  });

  it('selecting China persists the preference and re-renders the selector on it', async () => {
    const h = makePopupHarness();
    await openSettingsView(h);

    const select = document.querySelector<HTMLSelectElement>('#qwen-site-select')!;
    select.value = 'china';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(h.local.snapshot()[QWEN_SITE_STORAGE_KEY]).toBe('china'));
    const reRendered = document.querySelector<HTMLSelectElement>('#qwen-site-select')!;
    expect(reRendered.value).toBe('china'); // the re-render reflects the persisted site
  });

  it('reads the stored preference on load — China shows selected after reopening the popup', async () => {
    const h = makePopupHarness();
    await h.local.set({ [QWEN_SITE_STORAGE_KEY]: 'china' });
    await openSettingsView(h);

    expect(document.querySelector<HTMLSelectElement>('#qwen-site-select')!.value).toBe('china');
  });

  it('an invalid stored preference defaults the selector to International (read-on-load contract)', async () => {
    const h = makePopupHarness();
    await h.local.set({ [QWEN_SITE_STORAGE_KEY]: 'singapore' });
    await openSettingsView(h);

    expect(document.querySelector<HTMLSelectElement>('#qwen-site-select')!.value).toBe('international');
  });

  it('a site switch never touches the credential namespace', async () => {
    const h = makePopupHarness();
    const pair = PROVIDER_CREDENTIALS.qwen as Extract<Credential, { type: 'ak-sk' }>;
    await new KeyStore(h.local).saveCredential('qwen', pair); // the pair the selector's own section carries
    await openSettingsView(h);

    const select = document.querySelector<HTMLSelectElement>('#qwen-site-select')!;
    select.value = 'china';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(h.local.snapshot()[QWEN_SITE_STORAGE_KEY]).toBe('china'));

    expect(h.local.snapshot()[storageKey('qwen')]).toEqual({ // pair untouched
      accessKeyId: pair.accessKeyId,
      accessKeySecret: pair.accessKeySecret,
    });
    expect(document.body.textContent).toContain('AccessKeyId: ••••sKey'); // masked state intact
  });
});

describe('controller — Badge Provider Selector (popup-ui spec §Badge Provider Selector; hito-12 WU-D2)', () => {
  async function openSettingsView(h: { api: BrowserApi }): Promise<void> {
    mountApp();
    await openPopup(h);
    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#badge-provider-select')).not.toBeNull());
  }

  it('defaults to ZAI with the unmasked displayName label when no preference is stored', async () => {
    const h = makePopupHarness();
    await openSettingsView(h);

    const select = document.querySelector<HTMLSelectElement>('#badge-provider-select')!;
    expect(select.value).toBe('zai');
    expect(select.selectedOptions[0]!.textContent).toBe('ZAI (Zhipu AI)'); // label rendered unmasked
  });

  it('lists exactly the SHIPPED providers in registry order — data-driven, no unshipped options', async () => {
    const h = makePopupHarness();
    await openSettingsView(h);

    const options = [...document.querySelectorAll('#badge-provider-select option')];
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['zai', 'qwen']);
    expect(options.map((option) => option.textContent)).toEqual(['ZAI (Zhipu AI)', 'Qwen (Alibaba Cloud BSS)']);
  });

  it('selecting Qwen persists the preference and re-renders the selector on it', async () => {
    const h = makePopupHarness();
    await openSettingsView(h);

    const select = document.querySelector<HTMLSelectElement>('#badge-provider-select')!;
    select.value = 'qwen';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(h.local.snapshot()[BADGE_PROVIDER_STORAGE_KEY]).toBe('qwen'));
    const reRendered = document.querySelector<HTMLSelectElement>('#badge-provider-select')!;
    expect(reRendered.value).toBe('qwen'); // the re-render reflects the persisted choice
  });

  it('reads the stored preference on load — Qwen shows selected after reopening the popup', async () => {
    const h = makePopupHarness();
    await h.local.set({ [BADGE_PROVIDER_STORAGE_KEY]: 'qwen' });
    await openSettingsView(h);

    expect(document.querySelector<HTMLSelectElement>('#badge-provider-select')!.value).toBe('qwen');
  });

  it('an invalid stored preference defaults the selector to ZAI (read-on-load contract)', async () => {
    const h = makePopupHarness();
    await h.local.set({ [BADGE_PROVIDER_STORAGE_KEY]: 'deepseek' });
    await openSettingsView(h);

    expect(document.querySelector<HTMLSelectElement>('#badge-provider-select')!.value).toBe('zai');
  });

  it('a badge-provider switch never touches the credential namespace', async () => {
    const h = makePopupHarness();
    await seedZaiKey(h.local, 'sk-zai-isolated-8888');
    await openSettingsView(h);

    const select = document.querySelector<HTMLSelectElement>('#badge-provider-select')!;
    select.value = 'qwen';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(h.local.snapshot()[BADGE_PROVIDER_STORAGE_KEY]).toBe('qwen'));

    expect(h.local.snapshot()[storageKey('zai')]).toBe('sk-zai-isolated-8888'); // keys untouched
    expect(document.body.textContent).toContain('••••8888'); // masked state intact
  });
});

describe('controller — Qwen Plan Key Settings Group (popup-ui spec §Qwen Plan Key Settings Group, hito-8)', () => {
  const PLAN_SLOT_KEY = `${KEY_STORAGE_PREFIX}qwen-plan`;
  const PAIR_CREDENTIAL = PROVIDER_CREDENTIALS.qwen as Extract<Credential, { type: 'ak-sk' }>;

  async function openSettingsView(h: { api: BrowserApi }): Promise<void> {
    mountApp();
    await openPopup(h);
    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#key-input-qwen-plan')).not.toBeNull());
  }

  it('a valid sk-sp- key persists through the plan slot and displays masked; the stored pair is unchanged', async () => {
    const h = makePopupHarness();
    await new KeyStore(h.local).saveCredential('qwen', PAIR_CREDENTIAL); // pair stored first
    await openSettingsView(h);

    const planKey = 'sk-sp-plan-key-abcd1234';
    document.querySelector<HTMLInputElement>('#key-input-qwen-plan')!.value = planKey;
    document.querySelector<HTMLButtonElement>('#key-add-qwen-plan')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('Plan key: ••••1234'));
    expect(h.local.snapshot()[PLAN_SLOT_KEY]).toBe(planKey); // persisted through the plan slot
    expect(h.local.snapshot()[storageKey('qwen')]).toEqual({ // pair untouched
      accessKeyId: PAIR_CREDENTIAL.accessKeyId,
      accessKeySecret: PAIR_CREDENTIAL.accessKeySecret,
    });
    expect(document.querySelector<HTMLInputElement>('#key-input-qwen-plan')!.value).toBe(''); // cleared on valid submit
    expect(document.documentElement.textContent ?? '').not.toContain(planKey); // full key never in DOM
  });

  it('a non-sk-sp value is rejected with the plan-key guidance and nothing persists', async () => {
    const h = makePopupHarness();
    await openSettingsView(h);

    document.querySelector<HTMLInputElement>('#key-input-qwen-plan')!.value = 'sk-ordinary-dashscope-key';
    document.querySelector<HTMLButtonElement>('#key-add-qwen-plan')!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain(QWEN_PLAN_KEY_GUIDANCE));
    expect(h.local.snapshot()[PLAN_SLOT_KEY]).toBeUndefined();
    expect(document.querySelector<HTMLInputElement>('#key-input-qwen-plan')!.value).toBe('sk-ordinary-dashscope-key'); // keeps text
  });

  it('plan guidance and the static AK/SK guidance are distinct — the pair copy never regresses', async () => {
    expect(QWEN_PLAN_KEY_GUIDANCE).not.toBe(QWEN_AK_SK_GUIDANCE);
  });

  it('revoking the plan key leaves the AK/SK pair stored and displayed masked', async () => {
    const h = makePopupHarness();
    const keys = new KeyStore(h.local);
    await keys.saveCredential('qwen', PAIR_CREDENTIAL);
    await keys.saveCredential('qwen-plan', { type: 'qwen-plan', token: 'sk-sp-plan-key-abcd1234' });
    await openSettingsView(h);
    await vi.waitFor(() => expect(document.body.textContent).toContain('Plan key: ••••1234'));

    document.querySelector<HTMLButtonElement>('#key-revoke-qwen-plan')!.click();

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('••••1234'));
    expect(h.local.snapshot()[PLAN_SLOT_KEY]).toBeUndefined();
    expect(h.local.snapshot()[storageKey('qwen')]).toEqual({ // pair survives the plan revoke
      accessKeyId: PAIR_CREDENTIAL.accessKeyId,
      accessKeySecret: PAIR_CREDENTIAL.accessKeySecret,
    });
    expect(document.body.textContent).toContain('AccessKeyId: ••••sKey'); // still displayed masked
  });

  it('revoking the AK/SK pair leaves the plan key stored and displayed masked', async () => {
    const h = makePopupHarness();
    const keys = new KeyStore(h.local);
    await keys.saveCredential('qwen', PAIR_CREDENTIAL);
    await keys.saveCredential('qwen-plan', { type: 'qwen-plan', token: 'sk-sp-plan-key-abcd1234' });
    await openSettingsView(h);
    await vi.waitFor(() => expect(document.body.textContent).toContain('Plan key: ••••1234'));

    document.querySelector<HTMLButtonElement>('#key-revoke-qwen')!.click();

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('AccessKeyId: ••••sKey'));
    expect(h.local.snapshot()[storageKey('qwen')]).toBeUndefined();
    expect(h.local.snapshot()[PLAN_SLOT_KEY]).toBe('sk-sp-plan-key-abcd1234'); // plan survives the pair revoke
    expect(document.body.textContent).toContain('Plan key: ••••1234');
  });
});

describe('controller — stacked qwen settings form (user-reported squeeze fix)', () => {
  it('renders one labeled field per row for the qwen pair and the plan group, controls on their own rows', async () => {
    const h = makePopupHarness();
    mountApp();
    await openPopup(h);
    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#key-input-qwen-plan')).not.toBeNull());

    for (const formId of ['qwen', 'qwen-plan'] as const) {
      const form = document.querySelector<HTMLFormElement>(`form[data-provider="${formId}"]`)!;
      const fields = form.querySelectorAll('.credential-field');
      expect(fields.length).toBe(formId === 'qwen' ? 2 : 1); // one row per credential field
      for (const field of fields) {
        expect(field.querySelectorAll('input')).toHaveLength(1); // never two fields sharing a row
        expect(field.querySelector('label')).not.toBeNull(); // each field carries its own label
      }
      const actions = form.querySelectorAll('.form-actions');
      expect(actions).toHaveLength(1); // controls live on their own line after the fields
      expect(actions[0]!.querySelectorAll('button')).toHaveLength(2); // save + revoke together
      expect(actions[0]!.querySelectorAll('input')).toHaveLength(0); // no field inside the controls row
    }
  });
});

describe('controller — plan-only qwen card (popup-ui spec §Qwen Plan Line, hito-8)', () => {
  it('a stored plan key with no pair renders the qwen card showing the plan line and no balance', async () => {
    const h = makePopupHarness();
    await new KeyStore(h.local).saveCredential('qwen-plan', { type: 'qwen-plan', token: 'sk-sp-plan-key-abcd1234' });
    await seedSnapshot(h.local, {
      results: {
        qwen: {
          status: 'ok',
          usage: {
            providerId: 'qwen',
            kind: 'balance',
            plan: { status: 'exhausted', resetAt: NOW_MS + 90 * 60_000 },
            fetchedAt: NOW_MS,
          },
        },
      },
    });
    mountApp();
    await openPopup(h);

    const qwen = document.querySelector('section[data-provider="qwen"]');
    expect(qwen).not.toBeNull(); // the card renders on the plan key alone
    const text = qwen!.textContent ?? '';
    expect(text).toContain('Plan: exhausted · resets in 1h 30m');
    expect(text).not.toContain('No cycle data yet');
    expect(text).not.toContain('¥'); // no balance figure on a plan-only card
    expect((qwen!.querySelector('.usage') as HTMLElement | null)?.textContent).toBe(''); // empty usage line, like monitor cards
  });
});

describe('controller — wrong-platform guidance (AD-27; popup-ui spec)', () => {
  it('a ZAI auth-error snapshot surfaces the wrong-platform guidance in the main view', async () => {
    const h = makePopupHarness();
    await seedSnapshot(h.local, { results: { zai: { status: 'error', errorClass: 'auth' } } });
    await seedAllKeys(h.local); // hito-6: the error card renders for a CREDENTIALED provider
    mountApp();
    await openPopup(h);

    const text = document.body.textContent ?? '';
    expect(text).toContain('Auth failed'); // per-class label (AD-21/22)
    expect(text).toContain(ZAI_WRONG_PLATFORM_GUIDANCE); // static derivation, no payload change (AD-13)
  });

  it('a ZAI rate-limit error shows the class label only — no guidance', async () => {
    const h = makePopupHarness();
    await seedSnapshot(h.local, { results: { zai: { status: 'error', errorClass: 'rate-limit' } } });
    await seedAllKeys(h.local);
    mountApp();
    await openPopup(h);

    const text = document.body.textContent ?? '';
    expect(text).toContain('Rate limited');
    expect(text).not.toContain(ZAI_WRONG_PLATFORM_GUIDANCE);
  });
});

/** The cycle a manual refresh lands after the tick: 5h drops to 55%. */
const REFRESHED_CYCLE: CycleSnapshot = {
  results: {
    zai: {
      status: 'ok',
      usage: {
        providerId: 'zai',
        kind: 'cost',
        windows: { fiveHour: { percentage: 55, used: 6_600, total: 12_000 } },
        fetchedAt: NOW_MS + 5_000,
      },
    },
  },
};

/** How many times the popup read `qd:snapshot` from the local area so far. */
const snapshotReads = (h: { local: FakeStorageArea }): number =>
  h.local.calls.filter((call) => call.op === 'get' && call.args[0] === SNAPSHOT_STORAGE_KEY).length;

describe('controller — Manual Refresh Control (popup-ui spec, hito-6)', () => {
  /** Opens the main view with a full cycle and every provider keyed. */
  async function openKeyedMain(h: { api: BrowserApi; local: FakeStorageArea }): Promise<void> {
    await seedSnapshot(h.local, LAST_CYCLE);
    await seedAllKeys(h.local);
    mountApp();
    await openPopup(h);
  }

  it('activation registers the storage-change listener, THEN creates refresh-now with an immediate when [activation]', async () => {
    const h = makePopupHarness();
    await openKeyedMain(h);

    const listenSpy = vi.spyOn(h.browser.onChanged, 'listen');
    const createSpy = vi.spyOn(h.browser.alarms, 'create');

    document.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.click();

    expect(createSpy).toHaveBeenCalledWith('refresh-now', { when: NOW_MS + 1 }); // one-shot, immediate when
    expect(listenSpy).toHaveBeenCalledTimes(1); // the click registered exactly one listener…
    // …BEFORE the alarm: the tick's snapshot write can never race the subscription.
    expect(listenSpy.mock.invocationCallOrder[0]).toBeLessThan(createSpy.mock.invocationCallOrder[0]);
  });

  it('a storage change to qd:snapshot re-reads the cycle and re-renders the main view [re-read]', async () => {
    const h = makePopupHarness();
    await openKeyedMain(h);
    expect(document.querySelector('.hero-percentage')?.textContent).toBe('137%'); // pre-refresh figure

    document.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.click();
    await seedSnapshot(h.local, REFRESHED_CYCLE); // the alarm tick's write → chrome-shaped change event

    await vi.waitFor(() => expect(document.querySelector('.hero-percentage')?.textContent).toBe('55%'));
    expect(document.body.textContent).toContain('5h: 6600 / 12000'); // re-rendered from the re-read snapshot
  });

  it('repeated clicks add no listeners — one snapshot write triggers exactly one re-read', async () => {
    const h = makePopupHarness();
    await openKeyedMain(h);
    const readsBefore = snapshotReads(h);

    const refresh = document.querySelector<HTMLButtonElement>('[data-action="refresh"]')!;
    refresh.click();
    refresh.click();
    refresh.click();
    await seedSnapshot(h.local, REFRESHED_CYCLE);
    await vi.waitFor(() => expect(document.querySelector('.hero-percentage')?.textContent).toBe('55%'));

    expect(snapshotReads(h) - readsBefore).toBe(1); // one listener → exactly one re-read per change
  });

  it('ignores non-local areas and non-snapshot keys — no re-read, no re-render', async () => {
    const h = makePopupHarness();
    await openKeyedMain(h);
    document.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.click();
    expect(await h.browser.alarms.get('refresh-now')).toEqual({ name: 'refresh-now', when: NOW_MS + 1 });
    const readsAfterActivation = snapshotReads(h);

    // A snapshot-shaped change in the SYNC area never reaches the popup.
    h.browser.onChanged.dispatch({ [SNAPSHOT_STORAGE_KEY]: { newValue: REFRESHED_CYCLE } }, 'sync');
    // A local write to a different key is not the snapshot key.
    await h.local.set({ [ZAI_PLATFORM_STORAGE_KEY]: 'zhipu' });
    await Promise.resolve(); // flush microtasks so a wrong re-read would surface

    expect(snapshotReads(h)).toBe(readsAfterActivation); // neither event re-read…
    expect(document.querySelector('.hero-percentage')?.textContent).toBe('137%'); // …nor re-rendered
  });
});

describe('controller — Revocation from the Popup (popup-ui spec)', () => {
  async function openSettingsWith(
    h: { api: BrowserApi; local: FakeStorageArea },
    seeds: ReadonlyArray<[ProviderId, string]>,
  ): Promise<void> {
    for (const [, credential] of seeds) {
      await seedZaiKey(h.local, credential); // only zai seeds reach the rendered settings (hito-10)
    }
    mountApp();
    await openPopup(h);
    document.querySelector<HTMLButtonElement>('[data-action="open-settings"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#app form.key-form')).not.toBeNull());
  }

  it('revoking zai removes its stored key and the settings view reflects the absence', async () => {
    const h = makePopupHarness();
    await openSettingsWith(h, [['zai', 'sk-zai-aaaa1111']]);
    await vi.waitFor(() => expect(document.body.textContent).toContain('••••1111'));

    document.querySelector<HTMLButtonElement>('#key-revoke-zai')!.click();

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('••••1111'));
    expect(h.local.snapshot()[storageKey('zai')]).toBeUndefined();
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

  it('the refresh alarm name is a module-local literal — the popup never imports background.ts (AD-24)', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'controller.ts'), 'utf8');
    expect(source).toContain("'refresh-now'"); // module-local copy, pinned to the worker's literal
    expect(source).not.toMatch(/from\s+'\.\.\/background/); // no worker graph in the popup bundle
  });
});
