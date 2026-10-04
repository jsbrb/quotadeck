import { describe, expect, it } from 'vitest';
import { QWEN_AK_SK_GUIDANCE, QWEN_PLAN_KEY_GUIDANCE, validateCredential } from './credentials';

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

  it('accepts a non-empty raw monitor key (ZAI/ZHIPU, attached verbatim)', () => {
    expect(validateCredential('raw', 'zai-monitor-key-1a2b3c')).toEqual({ ok: true });
    expect(validateCredential('raw', '1919810123456789.abCdEfSecretPart')).toEqual({ ok: true });
  });

  it('rejects empty or blank credentials for every type', () => {
    for (const type of ['bearer', 'ak-sk', 'openai-admin-read', 'raw', 'qwen-plan'] as const) {
      expect(validateCredential(type, '').ok).toBe(false);
      expect(validateCredential(type, '   ').ok).toBe(false);
    }
  });
});

describe('validateCredential — qwen-plan type (hito-8 dual credential)', () => {
  it('accepts a non-empty sk-sp- plan key', () => {
    expect(validateCredential('qwen-plan', 'sk-sp-plan-key-1234567890abcdef')).toEqual({ ok: true });
  });

  it('rejects an empty or blank plan key with explicit guidance', () => {
    for (const candidate of ['', '   ']) {
      const result = validateCredential('qwen-plan', candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/empty/i);
      }
    }
  });

  it('rejects a non-sk-sp value with the plan-key guidance', () => {
    expect(validateCredential('qwen-plan', 'sk-ordinary-dashscope-key')).toEqual({
      ok: false,
      message: QWEN_PLAN_KEY_GUIDANCE,
    });
  });

  it('plan-key guidance is distinct from the AK/SK guidance and names the sk-sp- shape', () => {
    expect(QWEN_PLAN_KEY_GUIDANCE).not.toBe(QWEN_AK_SK_GUIDANCE);
    expect(QWEN_PLAN_KEY_GUIDANCE).toMatch(/sk-sp-/);
    expect(QWEN_PLAN_KEY_GUIDANCE).toMatch(/NOT the (?:Alibaba Cloud )?AK\/SK/i);
  });
});

describe('validateCredential — ak-sk pair mode (AD-17)', () => {
  it('accepts a complete Alibaba AK/SK pair', () => {
    expect(
      validateCredential('ak-sk', { accessKeyId: 'LTAI5tFakeAccessKeyId00', accessKeySecret: 'FakeSecretKey0000000000000000000' }),
    ).toEqual({ ok: true });
  });

  it.each([
    { case: 'empty accessKeyId', pair: { accessKeyId: '', accessKeySecret: 'secret-0000000000000000000000' } },
    { case: 'empty accessKeySecret', pair: { accessKeyId: 'LTAI5tFakeAccessKeyId00', accessKeySecret: '' } },
    { case: 'blank accessKeyId', pair: { accessKeyId: '   ', accessKeySecret: 'secret-0000000000000000000000' } },
    { case: 'blank accessKeySecret', pair: { accessKeyId: 'LTAI5tFakeAccessKeyId00', accessKeySecret: '   ' } },
  ])('rejects $case as incomplete', ({ pair }) => {
    const result = validateCredential('ak-sk', pair);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/empty/i);
    }
  });

  it.each([
    { case: 'sk- accessKeyId', pair: { accessKeyId: 'sk-dashscope-mistaken-for-ak', accessKeySecret: 'secret-0000000000000000000000' } },
    { case: 'sk- accessKeySecret', pair: { accessKeyId: 'LTAI5tFakeAccessKeyId00', accessKeySecret: 'sk-dashscope-mistaken-for-sk' } },
  ])('rejects $case with the AK/SK + RAM guidance', ({ pair }) => {
    const result = validateCredential('ak-sk', pair);
    expect(result).toEqual({ ok: false, message: QWEN_AK_SK_GUIDANCE });
  });
});
