import { beforeEach, describe, expect, it } from 'vitest';
import { KEY_STORAGE_PREFIX, KeyStore } from './key-store';
import { FakeBrowser } from '../testing/fake-browser';

// KeyStore tests (key-storage spec) over the type-aware Credential surface
// (AD-17). The transitional plain-string API left with the popup settings
// view (slice-1 deviation note 2): token credentials keep byte-identical
// plain-string STORAGE, and every display path masks each secret part.
describe('KeyStore — token credentials', () => {
  let browser: FakeBrowser;
  let store: KeyStore;

  beforeEach(() => {
    browser = new FakeBrowser();
    store = new KeyStore(browser.local);
  });

  it('round-trips a bearer token and stores it in storage.local under qd:key:{id}', async () => {
    await store.saveCredential('zai', { type: 'bearer', token: 'sk-zai-round-trip-key' });

    expect(await store.readCredential('zai', 'bearer')).toEqual({ type: 'bearer', token: 'sk-zai-round-trip-key' });
    // The value resides in the local area, under the namespaced key — nowhere else.
    expect(browser.local.snapshot()).toEqual({ [`${KEY_STORAGE_PREFIX}zai`]: 'sk-zai-round-trip-key' });
  });

  it('masked read reveals at most the last 4 characters and never the full key', async () => {
    await store.saveCredential('openai', { type: 'openai-admin-read', token: 'sk-test-1234567890abcdef' });

    const masked = await store.readMaskedCredential('openai', 'openai-admin-read');
    expect(masked).toEqual({ type: 'openai-admin-read', maskedToken: '••••cdef' });
  });

  it('masked read reveals nothing for a key shorter than the suffix', async () => {
    await store.saveCredential('kimi', { type: 'bearer', token: 'abcd' });
    expect(await store.readMaskedCredential('kimi', 'bearer')).toEqual({ type: 'bearer', maskedToken: '••••' });
  });

  it('revocation removes the credential: reads report absence', async () => {
    await store.saveCredential('openai', { type: 'openai-admin-read', token: 'sk-admin-revoked-key' });

    await store.revokeCredential('openai');

    expect(await store.readCredential('openai', 'openai-admin-read')).toBeUndefined();
    expect(await store.readMaskedCredential('openai', 'openai-admin-read')).toBeUndefined();
  });

  it('per-provider isolation: revoking one credential leaves the other untouched', async () => {
    await store.saveCredential('zai', { type: 'bearer', token: 'zai-credential' });
    await store.saveCredential('kimi', { type: 'bearer', token: 'kimi-credential' });

    await store.revokeCredential('zai');

    expect(await store.readCredential('zai', 'bearer')).toBeUndefined();
    expect(await store.readCredential('kimi', 'bearer')).toEqual({ type: 'bearer', token: 'kimi-credential' });
  });

  it('never calls chrome.storage.sync across every wrapper operation', async () => {
    await store.saveCredential('zai', { type: 'bearer', token: 'zai-credential' });
    await store.readCredential('zai', 'bearer');
    await store.readMaskedCredential('zai', 'bearer');
    await store.revokeCredential('zai');

    expect(browser.sync.calls).toHaveLength(0);
  });

  it('refuses to store an empty token or empty pair parts', async () => {
    await expect(store.saveCredential('zai', { type: 'bearer', token: '' })).rejects.toThrow(/empty/i);
    await expect(
      store.saveCredential('qwen', { type: 'ak-sk', accessKeyId: '', accessKeySecret: 'x' }),
    ).rejects.toThrow(/empty/i);
    expect(browser.local.snapshot()).toEqual({});
  });
});

describe('KeyStore — qwen AK/SK pair (AD-17)', () => {
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
});

describe('KeyStore — raw credentials (monitor attach mode)', () => {
  let browser: FakeBrowser;
  let store: KeyStore;

  beforeEach(() => {
    browser = new FakeBrowser();
    store = new KeyStore(browser.local);
  });

  it('round-trips a raw key as the plain-string token path under qd:key:{id}', async () => {
    await store.saveCredential('zai', { type: 'raw', token: 'zai-raw-monitor-key-9999' });

    expect(await store.readCredential('zai', 'raw')).toEqual({ type: 'raw', token: 'zai-raw-monitor-key-9999' });
    expect(browser.local.snapshot()).toEqual({ [`${KEY_STORAGE_PREFIX}zai`]: 'zai-raw-monitor-key-9999' });
  });

  it('masked read treats a raw key like any token: at most 4 trailing characters', async () => {
    await store.saveCredential('zai', { type: 'raw', token: 'zai-raw-monitor-key-9999' });

    expect(await store.readMaskedCredential('zai', 'raw')).toEqual({ type: 'raw', maskedToken: '••••9999' });
  });

  it('refuses to store an empty raw key', async () => {
    await expect(store.saveCredential('zai', { type: 'raw', token: '' })).rejects.toThrow(/empty/i);
    expect(browser.local.snapshot()).toEqual({});
  });
});
