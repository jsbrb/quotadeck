// Qwen BSS site binding (provider-framework spec §Qwen Parsing; AD-28
// mirror of core/zai-platforms.ts).
//
// Pure, popup-safe site table: no I/O, no storage, no provider registry
// knowledge. The selected site determines the base URL of EVERY Qwen BSS
// balance request — international (ap-southeast-1) is the DEFAULT; china
// accounts target business.aliyuncs.com. The preference itself lives in
// storage/qwen-site-store.ts (`qd:pref:*` namespace), never `qd:key:*`.

/** The two Alibaba BSS sites a Qwen credential can be bound to. */
export type QwenSite = 'international' | 'china';

/** Selector entry: id plus unmasked display label (never secret material). */
export interface QwenSiteOption {
  readonly id: QwenSite;
  readonly label: string;
}

/** Sites in selector render order; the first entry is the default. */
export const QWEN_SITES: readonly QwenSiteOption[] = [
  { id: 'international', label: 'International (default)' },
  { id: 'china', label: 'China' },
];

/** BSS OpenAPI base URL for a site (no trailing slash). */
export function qwenBssBaseUrl(site: QwenSite): string {
  return site === 'china' ? 'https://business.aliyuncs.com' : 'https://business.ap-southeast-1.aliyuncs.com';
}

/**
 * Runtime guard shared by the store and the provider seam: the site reaches
 * production code through storage reads, so an invalid stored value must be
 * recognizable before any dispatch (spec §Invalid site value rejected).
 */
export function isQwenSite(value: unknown): value is QwenSite {
  return value === 'international' || value === 'china';
}

/** Hostnames of the two BSS site bases, derived from the site table itself. */
const BSS_HOSTS: ReadonlySet<string> = new Set(
  QWEN_SITES.map((site) => new URL(qwenBssBaseUrl(site.id)).hostname),
);

/**
 * True only for the TWO BSS site hosts (china + international). This is the
 * RPC-signing exception scope (network/request.ts, hito-8): AccessKeyId may
 * appear in the query on these hosts ONLY — the token-plan probe host is a
 * qwen-allowlisted host that is deliberately NOT in this set.
 */
export function isQwenBssHost(host: string): boolean {
  return BSS_HOSTS.has(host.toLowerCase());
}
