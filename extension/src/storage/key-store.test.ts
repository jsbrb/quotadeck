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

describe('KeyStore — credential-aware surface (AD-17)', () => {
  let browser: FakeBrowser;
  let store: KeyStore;

  beforeEach(() => {
    browser = new FakeBrowser();
    store = new KeyStore(browser.local);
  });

  const PAIR = { type: 'ak-sk', accessKeyId: 'LTAI5tRoundTripAK00', accessKeySecret: 'RoundTripSecret0000000000000' } as const;

  it('round-trips a qwen AK/SK pair as one JSON object under qd:key:qwen', async () => {
    await store.saveCredential('qwen', PAIR);

    expect(await store.readCredential('qwen', 'ak-sk')).toEqual(PAIR);
    expect(browser.local.snapshot()).toEqual({
      [`${KEY_STORAGE_PREFIX}qwen`]: { accessKeyId: 'LTAI5tRoundTripAK00', accessKeySecret: 'RoundTripSecret0000000000000' },
    });
  });

  it('masks each pair part independently, revealing at most 4 suffix characters per part', async () => {
    await store.saveCredential('qwen', PAIR);

    const masked = await store.readMaskedCredential('qwen', 'ak-sk');
    expect(masked).toEqual({
      type: 'ak-sk',
      maskedAccessKeyId: '••••AK00',
      maskedAccessKeySecret: '••••0000',
    });
    const rendered = JSON.stringify(masked);
    expect(rendered).not.toContain(PAIR.accessKeyId);
    expect(rendered).not.toContain(PAIR.accessKeySecret);
  });

  it('revoking the qwen credential removes both parts atomically; other providers stay readable', async () => {
    await store.saveCredential('qwen', PAIR);
    await store.saveCredential('kimi', { type: 'bearer', token: 'kimi-token-abcdef' });

    await store.revokeCredential('qwen');

    expect(await store.readCredential('qwen', 'ak-sk')).toBeUndefined();
    expect(await store.readMaskedCredential('qwen', 'ak-sk')).toBeUndefined();
    expect(await store.readCredential('kimi', 'bearer')).toEqual({ type: 'bearer', token: 'kimi-token-abcdef' });
  });

  it('a legacy hito-2 plain string under qd:key:qwen reads as no credential (AD-17 migration)', async () => {
    await browser.local.set({ [`${KEY_STORAGE_PREFIX}qwen`]: 'legacy-hito2-string-key' });

    expect(await store.readCredential('qwen', 'ak-sk')).toBeUndefined();
    expect(await store.readMaskedCredential('qwen', 'ak-sk')).toBeUndefined();
  });

  it('token providers keep plain-string bytes — save/read round-trip is byte-identical', async () => {
    await store.saveCredential('zai', { type: 'bearer', token: 'zai-bytes-token-1234' });
    await store.saveCredential('openai', { type: 'openai-admin-read', token: 'sk-admin-bytes-5678' });

    expect(browser.local.snapshot()).toEqual({
      [`${KEY_STORAGE_PREFIX}zai`]: 'zai-bytes-token-1234',
      [`${KEY_STORAGE_PREFIX}openai`]: 'sk-admin-bytes-5678',
    });
    expect(await store.readCredential('zai', 'bearer')).toEqual({ type: 'bearer', token: 'zai-bytes-token-1234' });
    expect(await store.readCredential('openai', 'openai-admin-read')).toEqual({
      type: 'openai-admin-read',
      token: 'sk-admin-bytes-5678',
    });
  });

  it('masks token credentials on the display path like the legacy surface', async () => {
    await store.saveCredential('kimi', { type: 'bearer', token: 'kimi-mask-me-9999xyz' });
    expect(await store.readMaskedCredential('kimi', 'bearer')).toEqual({
      type: 'bearer',
      maskedToken: '••••9xyz',
    });
  });

  it('refuses to store an empty token or empty pair parts', async () => {
    await expect(store.saveCredential('zai', { type: 'bearer', token: '' })).rejects.toThrow(/empty/i);
    await expect(
      store.saveCredential('qwen', { type: 'ak-sk', accessKeyId: '', accessKeySecret: 'x' }),
    ).rejects.toThrow(/empty/i);
    expect(browser.local.snapshot()).toEqual({});
  });
});
