// zai-platform-store tests (key-storage spec §ZAI Platform Preference; AD-28)
// — hermetic over the FakeBrowser local area. The preference is NON-secret:
// it round-trips unmasked, lives in its own `qd:pref:` namespace, and never
// disturbs the credential namespace.
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeBrowser } from '../testing/fake-browser';
import { KeyStore, KEY_STORAGE_PREFIX } from './key-store';
import { readZaiPlatform, writeZaiPlatform, ZAI_PLATFORM_STORAGE_KEY } from './zai-platform-store';

describe('zai platform preference store (AD-28)', () => {
  let browser: FakeBrowser;

  beforeEach(() => {
    browser = new FakeBrowser();
  });

  it('round-trips a stored platform preference unmasked under qd:pref:zai-platform', async () => {
    await writeZaiPlatform(browser.local, 'zhipu');

    expect(await readZaiPlatform(browser.local)).toBe('zhipu');
    expect(browser.local.snapshot()).toEqual({ [ZAI_PLATFORM_STORAGE_KEY]: 'zhipu' });
    expect(ZAI_PLATFORM_STORAGE_KEY).toBe('qd:pref:zai-platform');
  });

  it('writes and reads back the default platform too', async () => {
    await writeZaiPlatform(browser.local, 'zai');
    expect(await readZaiPlatform(browser.local)).toBe('zai');
  });

  it('defaults to zai when no preference is stored', async () => {
    expect(await readZaiPlatform(browser.local)).toBe('zai');
  });

  it('defaults to zai when the stored value is invalid', async () => {
    await browser.local.set({ [ZAI_PLATFORM_STORAGE_KEY]: 'glm-free-tier' });

    expect(await readZaiPlatform(browser.local)).toBe('zai');
  });

  it('rejects an invalid platform on write and stores nothing', async () => {
    await expect(
      writeZaiPlatform(browser.local, 'bigmodel' as unknown as Parameters<typeof writeZaiPlatform>[1]),
    ).rejects.toThrow(/platform/i);
    expect(browser.local.snapshot()).toEqual({});
  });

  it('never touches the credential namespace: a stored key reads and masks normally', async () => {
    const keys = new KeyStore(browser.local);
    await keys.saveCredential('zai', { type: 'raw', token: 'zai-raw-key-123456' });
    await writeZaiPlatform(browser.local, 'zhipu');

    expect(await readZaiPlatform(browser.local)).toBe('zhipu');
    expect(await keys.readCredential('zai', 'raw')).toEqual({ type: 'raw', token: 'zai-raw-key-123456' });
    expect(await keys.readMaskedCredential('zai', 'raw')).toEqual({ type: 'raw', maskedToken: '••••3456' });
    // Two distinct namespaces coexist in the same area, nothing more.
    expect(Object.keys(browser.local.snapshot()).sort()).toEqual([
      `${KEY_STORAGE_PREFIX}zai`,
      ZAI_PLATFORM_STORAGE_KEY,
    ]);
  });
});
