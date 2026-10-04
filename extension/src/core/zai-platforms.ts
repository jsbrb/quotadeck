// ZAI monitor platform binding (zai-monitor spec §Platform Binding; AD-28).
//
// Pure, popup-safe platform table: no I/O, no storage, no provider registry
// knowledge. The selected platform determines the base URL of EVERY monitor
// request — Z.AI is the default; ZHIPU keys target the open platform host.
// The preference itself lives in storage/zai-platform-store.ts (`qd:pref:*`
// namespace), never under `qd:key:*`.

/** The two platforms a ZAI credential can be bound to. */
export type ZaiPlatform = 'zai' | 'zhipu';

/** Selector entry: id plus unmasked display label (never secret material). */
export interface ZaiPlatformOption {
  readonly id: ZaiPlatform;
  readonly label: string;
}

/** Platforms in selector render order; the first entry is the default. */
export const ZAI_PLATFORMS: readonly ZaiPlatformOption[] = [
  { id: 'zai', label: 'Z.AI' },
  { id: 'zhipu', label: 'ZHIPU' },
];

/** Monitor API base URL for a platform (no trailing slash). */
export function zaiMonitorBaseUrl(platform: ZaiPlatform): string {
  return platform === 'zhipu' ? 'https://open.bigmodel.cn' : 'https://api.z.ai';
}
