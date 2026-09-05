// zai-platforms tests (zai-monitor spec §Platform Binding; AD-28) — pure
// literal pins over the popup-safe platform table: union, labels, and the
// monitor base URL per platform.
import { describe, expect, it } from 'vitest';
import { ZAI_PLATFORMS, zaiMonitorBaseUrl, type ZaiPlatform } from './zai-platforms';

describe('ZAI_PLATFORMS (AD-28)', () => {
  it('lists exactly the two platforms with their display labels, zai first', () => {
    expect(ZAI_PLATFORMS).toEqual([
      { id: 'zai', label: 'Z.AI' },
      { id: 'zhipu', label: 'ZHIPU' },
    ]);
  });

  it('every platform id is a member of the ZaiPlatform union', () => {
    const ids = ZAI_PLATFORMS.map((platform) => platform.id);
    for (const id of ids) {
      const member: ZaiPlatform = id;
      expect(member).toBe(id);
    }
    expect(ids).toHaveLength(2);
  });
});

describe('zaiMonitorBaseUrl (AD-28)', () => {
  it('Z.AI (default) targets the international monitor host', () => {
    expect(zaiMonitorBaseUrl('zai')).toBe('https://api.z.ai');
  });

  it('ZHIPU targets the open platform monitor host', () => {
    expect(zaiMonitorBaseUrl('zhipu')).toBe('https://open.bigmodel.cn');
  });
});
