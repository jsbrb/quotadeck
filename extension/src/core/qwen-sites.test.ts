// qwen-sites tests (provider-framework spec §Qwen Parsing site selection;
// AD-28 mirror) — pure literal pins over the popup-safe site table: union,
// labels, and the BSS base URL per site.
import { describe, expect, it } from 'vitest';
import { isQwenBssHost, isQwenSite, QWEN_SITES, qwenBssBaseUrl, type QwenSite } from './qwen-sites';

describe('QWEN_SITES (site table)', () => {
  it('lists exactly the two sites with their display labels, international first (the default)', () => {
    expect(QWEN_SITES).toEqual([
      { id: 'international', label: 'International (default)' },
      { id: 'china', label: 'China' },
    ]);
  });

  it('every site id is a member of the QwenSite union', () => {
    const ids = QWEN_SITES.map((site) => site.id);
    for (const id of ids) {
      const member: QwenSite = id;
      expect(member).toBe(id);
    }
    expect(ids).toHaveLength(2);
  });
});

describe('qwenBssBaseUrl (site-selected BSS base)', () => {
  it('international (default) targets the ap-southeast-1 BSS host', () => {
    expect(qwenBssBaseUrl('international')).toBe('https://business.ap-southeast-1.aliyuncs.com');
  });

  it('china targets the china BSS host', () => {
    expect(qwenBssBaseUrl('china')).toBe('https://business.aliyuncs.com');
  });
});

describe('isQwenSite (runtime guard for the provider seam)', () => {
  it('admits exactly the union members and rejects everything else', () => {
    expect(isQwenSite('international')).toBe(true);
    expect(isQwenSite('china')).toBe(true);
    expect(isQwenSite('intl')).toBe(false);
    expect(isQwenSite(undefined)).toBe(false);
  });
});

describe('isQwenBssHost (RPC-signing exception scope, hito-8)', () => {
  it('admits exactly the two BSS site hosts — and NOT the qwen-allowlisted probe host', () => {
    expect(isQwenBssHost('business.aliyuncs.com')).toBe(true);
    expect(isQwenBssHost('business.ap-southeast-1.aliyuncs.com')).toBe(true);
    expect(isQwenBssHost('token-plan.ap-southeast-1.maas.aliyuncs.com')).toBe(false);
    expect(isQwenBssHost('api.openai.com')).toBe(false);
    expect(isQwenBssHost('BUSINESS.ALIYUNCS.COM')).toBe(true); // case-insensitive
  });
});
