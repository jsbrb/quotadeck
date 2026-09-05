import { beforeEach, describe, expect, it } from 'vitest';
import { KEY_STORAGE_PREFIX, KeyStore } from './key-store';
import { FakeBrowser } from '../testing/fake-browser';

describe('KeyStore', () => {
  let browser: FakeBrowser;
  let store: KeyStore;

  beforeEach(() => {
    browser = new FakeBrowser();
    store = new KeyStore(browser.storage.local);
  });

  it('round-trips a saved key and stores it in storage.local under qd:key:{id}', async () => {
    const credential = 'sk-zai-round-trip-key';
    await store.saveKey('zai', credential);

    expect(await store.readKey('zai')).toBe(credential);
    // The value resides in the local area, under the namespaced key — nowhere else.
    expect(browser.local.snapshot()).toEqual({ [`${KEY_STORAGE_PREFIX}zai`]: credential });
  });

  it('masked read reveals at most the last 4 characters and never the full key', async () => {
    const credential = 'sk-test-1234567890abcdef';
    await store.saveKey('openai', credential);

    const masked = await store.readMaskedKey('openai');
    expect(masked).toBe('••••cdef');
    expect(masked).not.toContain(credential);
    expect(masked!.endsWith(credential.slice(-4))).toBe(true);
    expect(masked!.length).toBeLessThanOrEqual(8);
  });

  it('masked read reveals nothing for a key shorter than the suffix', async () => {
    await store.saveKey('kimi', 'abcd');
    expect(await store.readMaskedKey('kimi')).toBe('••••');
  });

  it('revocation removes the key: reads report absence', async () => {
    await store.saveKey('openai', 'sk-admin-revoked-key');
    await store.revokeKey('openai');

    expect(await store.readKey('openai')).toBeUndefined();
    expect(await store.readMaskedKey('openai')).toBeUndefined();
  });

  it('per-provider isolation: revoking one key leaves the other untouched', async () => {
    await store.saveKey('zai', 'zai-credential');
    await store.saveKey('kimi', 'kimi-credential');

    await store.revokeKey('zai');

    expect(await store.readKey('zai')).toBeUndefined();
    expect(await store.readKey('kimi')).toBe('kimi-credential');
  });

  it('never calls chrome.storage.sync across every wrapper operation', async () => {
    await store.saveKey('zai', 'zai-credential');
    await store.readKey('zai');
    await store.readMaskedKey('zai');
    await store.revokeKey('zai');

    expect(browser.sync.calls).toHaveLength(0);
  });

  it('refuses to store an empty credential', async () => {
    await expect(store.saveKey('zai', '')).rejects.toThrow(/empty credential/i);
    expect(browser.local.snapshot()).toEqual({});
  });
});
