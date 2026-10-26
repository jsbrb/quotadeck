// badge-provider-store tests (hito-12 WU-D2 §Badge Provider Preference) —
// hermetic over the FakeBrowser local area, mirroring the zai-platform-store
// and qwen-site-store siblings. The preference is NON-secret: it round-trips
// unmasked, lives in its own `qd:pref:` namespace, and never disturbs the
// credential namespace. Validation is ProviderId-wide (NOT shipped-wide): an
// unshipped-but-known id stays a legal preference so re-shipping never
// invalidates stored values.
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeBrowser } from '../testing/fake-browser';
import { KeyStore, KEY_STORAGE_PREFIX } from './key-store';
import { BADGE_PROVIDER_STORAGE_KEY, readBadgeProvider, writeBadgeProvider } from './badge-provider-store';

describe('badge provider preference store (hito-12 WU-D2)', () => {
  let browser: FakeBrowser;

  beforeEach(() => {
    browser = new FakeBrowser();
  });

  it('round-trips a stored provider preference unmasked under qd:pref:badge-provider', async () => {
    await writeBadgeProvider(browser.local, 'qwen');

    expect(await readBadgeProvider(browser.local)).toBe('qwen');
    expect(browser.local.snapshot()).toEqual({ [BADGE_PROVIDER_STORAGE_KEY]: 'qwen' });
    expect(BADGE_PROVIDER_STORAGE_KEY).toBe('qd:pref:badge-provider');
  });

  it('writes and reads back the default provider too', async () => {
    await writeBadgeProvider(browser.local, 'zai');
    expect(await readBadgeProvider(browser.local)).toBe('zai');
  });

  it('defaults to zai when no preference is stored', async () => {
    expect(await readBadgeProvider(browser.local)).toBe('zai');
  });

  it('defaults to zai when the stored value is invalid (no write-on-read)', async () => {
    // 'deepseek' was the sentinel until hito-13 made it a real id — 'claude'
    // stays outside PROVIDER_METADATA, which is the property under test.
    await browser.local.set({ [BADGE_PROVIDER_STORAGE_KEY]: 'claude' });

    expect(await readBadgeProvider(browser.local)).toBe('zai');
    expect(browser.local.snapshot()).toEqual({ [BADGE_PROVIDER_STORAGE_KEY]: 'claude' }); // not rewritten
  });

  it('rejects an invalid provider id on write and stores nothing', async () => {
    await expect(
      writeBadgeProvider(browser.local, 'DEEPSEEK' as unknown as Parameters<typeof writeBadgeProvider>[1]),
    ).rejects.toThrow(/provider/i);
    expect(browser.local.snapshot()).toEqual({});
  });

  it('accepts a valid but UNshipped provider id — validation stays ProviderId-wide', async () => {
    await writeBadgeProvider(browser.local, 'kimi');

    expect(await readBadgeProvider(browser.local)).toBe('kimi');
    expect(browser.local.snapshot()).toEqual({ [BADGE_PROVIDER_STORAGE_KEY]: 'kimi' });
  });

  it('never touches the credential namespace: a stored raw key reads and masks normally', async () => {
    const keys = new KeyStore(browser.local);
    await keys.saveCredential('zai', { type: 'raw', token: 'sk-zai-namespace-9999' });
    await writeBadgeProvider(browser.local, 'qwen');

    expect(await readBadgeProvider(browser.local)).toBe('qwen');
    expect(await keys.readCredential('zai', 'raw')).toEqual({ type: 'raw', token: 'sk-zai-namespace-9999' });
    expect(await keys.readMaskedCredential('zai', 'raw')).toEqual({ type: 'raw', maskedToken: '••••9999' });
    // Two distinct namespaces coexist in the same area, nothing more.
    expect(Object.keys(browser.local.snapshot()).sort()).toEqual([
      `${KEY_STORAGE_PREFIX}zai`,
      BADGE_PROVIDER_STORAGE_KEY,
    ]);
  });
});
