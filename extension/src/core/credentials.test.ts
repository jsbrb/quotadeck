import { describe, expect, it } from 'vitest';
import { validateCredential } from './credentials';

describe('validateCredential', () => {
  it('rejects a DashScope sk- key for the ak-sk type with AK/SK + RAM guidance', () => {
    const result = validateCredential('ak-sk', 'sk-dashscope-not-alibaba');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/AK\/SK/);
      expect(result.message).toMatch(/bss:DescribeAcccount/);
    }
  });

  it('accepts a plausible Alibaba AccessKeyId for the ak-sk type', () => {
    expect(validateCredential('ak-sk', 'LTAI5tFakeAccessKeyId00')).toEqual({ ok: true });
  });

  it('accepts non-empty bearer and OpenAI admin keys', () => {
    expect(validateCredential('bearer', 'zai-token-1a2b3c')).toEqual({ ok: true });
    expect(validateCredential('openai-admin-read', 'sk-admin-proj-readkey')).toEqual({ ok: true });
  });

  it('rejects empty or blank credentials for every type', () => {
    for (const type of ['bearer', 'ak-sk', 'openai-admin-read'] as const) {
      expect(validateCredential(type, '').ok).toBe(false);
      expect(validateCredential(type, '   ').ok).toBe(false);
    }
  });
});
