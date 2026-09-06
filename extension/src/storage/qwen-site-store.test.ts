// qwen-site-store tests (key-storage spec §Qwen Site Preference; AD-28
// mirror) — hermetic over the FakeBrowser local area. The preference is
// NON-secret: it round-trips unmasked, lives in its own `qd:pref:` namespace,
// and never disturbs the credential namespace.
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeBrowser } from '../testing/fake-browser';
import { KeyStore, KEY_STORAGE_PREFIX } from './key-store';
import { QWEN_SITE_STORAGE_KEY, readQwenSite, writeQwenSite } from './qwen-site-store';

describe('qwen site preference store (AD-28 mirror)', () => {
  let browser: FakeBrowser;

  beforeEach(() => {
    browser = new FakeBrowser();
  });

  it('round-trips a stored site preference unmasked under qd:pref:qwen-site', async () => {
    await writeQwenSite(browser.local, 'china');

    expect(await readQwenSite(browser.local)).toBe('china');
    expect(browser.local.snapshot()).toEqual({ [QWEN_SITE_STORAGE_KEY]: 'china' });
    expect(QWEN_SITE_STORAGE_KEY).toBe('qd:pref:qwen-site');
  });

  it('writes and reads back the default site too', async () => {
    await writeQwenSite(browser.local, 'international');
    expect(await readQwenSite(browser.local)).toBe('international');
  });

  it('defaults to international when no preference is stored', async () => {
    expect(await readQwenSite(browser.local)).toBe('international');
  });

  it('defaults to international when the stored value is invalid (no write-on-read)', async () => {
    await browser.local.set({ [QWEN_SITE_STORAGE_KEY]: 'singapore' });

    expect(await readQwenSite(browser.local)).toBe('international');
    expect(browser.local.snapshot()).toEqual({ [QWEN_SITE_STORAGE_KEY]: 'singapore' }); // not rewritten
  });

  it('rejects an invalid site on write and stores nothing', async () => {
    await expect(
      writeQwenSite(browser.local, 'global' as unknown as Parameters<typeof writeQwenSite>[1]),
    ).rejects.toThrow(/site/i);
    expect(browser.local.snapshot()).toEqual({});
  });

  it('never touches the credential namespace: a stored AK/SK pair reads and masks normally', async () => {
    const keys = new KeyStore(browser.local);
    await keys.saveCredential('qwen', {
      type: 'ak-sk',
      accessKeyId: 'LTAI5tQwenAccessKey',
      accessKeySecret: 'QwenPairSecret00000000000000',
    });
    await writeQwenSite(browser.local, 'china');

    expect(await readQwenSite(browser.local)).toBe('china');
    expect(await keys.readCredential('qwen', 'ak-sk')).toEqual({
      type: 'ak-sk',
      accessKeyId: 'LTAI5tQwenAccessKey',
      accessKeySecret: 'QwenPairSecret00000000000000',
    });
    expect(await keys.readMaskedCredential('qwen', 'ak-sk')).toEqual({
      type: 'ak-sk',
      maskedAccessKeyId: '••••sKey',
      maskedAccessKeySecret: '••••0000',
    });
    // Two distinct namespaces coexist in the same area, nothing more.
    expect(Object.keys(browser.local.snapshot()).sort()).toEqual([
      `${KEY_STORAGE_PREFIX}qwen`,
      QWEN_SITE_STORAGE_KEY,
    ]);
  });
});
