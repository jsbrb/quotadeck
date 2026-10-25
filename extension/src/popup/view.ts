// Popup view (popup-ui spec §Settings Gear Surface, §Per-Model Consumption
// View, §ZAI Platform Selector; AD-11/22/26/27/28) — pure string-producing
// functions only. No DOM, no I/O, and no imports beyond core/storage types,
// the usage helpers and the popup-safe platform table, so node-environment
// tests pin determinism with strict string equality.
//
// Rendering contract (AD-22/26):
// - Two views: `renderMain` (default consumption view) and `renderSettings`
//   (all key management). The header of each carries the switch — a
//   `data-action="open-settings"` gear on main, `data-action="back"` on
//   settings — wired by the controller's click delegation. The footer nav
//   (hito-11) mirrors the switch: exactly two tabs — QUOTAS (active on main)
//   and KEYS (active on settings) — wired to the SAME open-settings/back
//   data-actions. Nothing else exists: no LOGS/STATS tabs, no fake telemetry.
// - Main view: one provider CARD per KEYED provider in PopupState.providers
//   order (PROVIDER_METADATA order in production, AD-6) — keyless providers
//   render no card at all (hito-6); the settings view keeps every provider.
//   The main header carries the refresh affordance
//   (`data-action="refresh"`, hito-6 §Manual Refresh Control) next to the
//   gear, plus a real `PLAN · <level>` chip derived from the ZAI cycle entry
//   (hito-11 — the design's LIVE badge is fake telemetry and never renders).
//   Every card hero sits inside a click-to-choose affordance (`.hero-pick`
//   carrying `data-action="set-badge"` and a static title tooltip): clicking
//   it makes that provider the toolbar badge (hito-12 WU-M2 — the settings
//   dropdown remains the explicit path and BOTH write the same store). The
//   badge-owning card shows a `.chip-badge` marker exactly once — beside the
//   hero when the live card renders one, beside the provider name otherwise;
//   cards without a hero have no click target and nothing is synthesized.
//   ZAI renders its monitor block from `usage.windows` (plan level, 5h/weekly
//   windows with the percentage uncapped, used/total, countdown via the pure
//   `formatResetCountdown` from `windows.*.resetAt` rendered as a distinct
//   `.countdown` element, and the monthly MCP window with per-tool rows);
//   where a card's primary percentage exists (ZAI: the 5h window; qwen: the
//   token-plan quota — hito-12 WU-M user-ratified twin-card rule, supersedes
//   the WU-D3 line-only render) it renders
//   TWICE — as the card's largest, boldest element (`.hero-percentage`,
//   threshold-colored, hito-11) above all other card content, and as the
//   same number inside its threshold bar (`.bar-pct`) — while secondary info
//   (window label, used/total, countdown) stays in normal weight below;
//   every percentage-bearing window and the MCP window carry a
//   threshold-colored bar (`band-green|band-amber|band-red`, contiguous
//   bands from the rounded displayed percentage; visual fill caps at 100
//   while percentage text stays uncapped; MCP fill derives from
//   used/ceiling — presentation only, never a synthesized percentage);
//   the qwen quota monitor block sits between the balance and the binary
//   plan line: the `Token Plan:` line keeps only the countdown (derived at
//   display time from `quota.resetAt`), a percentage-only quota renders the
//   bar alone, a quota without a percentage renders the resets line without
//   a bar or hero, and a quota without either field renders nothing;
//   OpenAI renders per-model rows from `usage.breakdown` sorted by
//   (model, usageType) for determinism; failed
//   providers render a
//   per-class error label inside the same card structure (AD-21), and a ZAI
//   auth failure additionally surfaces the static wrong-platform guidance
//   (AD-27 — derived here from (provider, class), never transported in the
//   snapshot). When the errored provider has a last-known success (WU2's
//   `snapshot.lastKnown`), the card additionally renders that frozen usage
//   dimmed under a `LAST KNOWN · T-<age>` chip — the age derives from the
//   state's `nowMs` vs the entry's `fetchedAt`, never from Date.now().
//   NO key forms appear in the main view — key state and forms live in
//   settings only.
// - Settings view: each provider section renders its static SETTINGS_GUIDANCE
//   copy (popup-ui §Settings Guidance) before its input(s) — key-independent
//   and distinct from validation errors. The ZAI section carries the
//   platform selector (AD-28), rendered from the pure ZAI_PLATFORMS table
//   with unmasked labels and the current preference marked `selected`; the
//   qwen section carries the site selector (popup-ui §Qwen Site Selector)
//   from the pure QWEN_SITES table the same way; the controller owns
//   persistence for both.
// - Both views end with the shared branding footer (popup-ui §Branding
//   Footer): "Built by The North Code" → https://www.thenorthcode.es/ —
//   preceded (hito-11) by the honest version. The BrowserApi port exposes no
//   runtime.getManifest, so plumbing the live version would widen the port
//   disproportionately; POPUP_VERSION is a static constant pinned equal to
//   the manifest version by a test that reads public/manifest.json.
// - Icons (hito-11): inline 2px-stroke SVG paths only — no icon fonts, no
//   remote references of any kind in rendered output.
// - Every dynamic string is escaped (AD-3 spirit): provider-sourced levels,
//   tool names, model names, guidance messages and masked keys all pass
//   escapeHtml.
// - The view renders exactly the masked forms it is given; full keys never
//   reach this module (AD-15).
import type { CredentialType, ProviderId } from '../core/provider';
import type { QwenSite } from '../core/qwen-sites';
import { QWEN_SITES } from '../core/qwen-sites';
import type { ErrorClass } from '../refresh/error-taxonomy';
import { currencySymbol, type LineItem, type NormalizedUsage, type PlanInfo, type TokenPlanQuota, type UsageWindow } from '../core/usage';
import { ZAI_PLATFORMS, type ZaiPlatform } from '../core/zai-platforms';
import type { CredentialSlot, MaskedCredential } from '../storage/key-store';
import type { CycleSnapshot } from '../storage/snapshot-store';

/** Provider metadata the view needs; supplied from PROVIDER_METADATA (AD-24). */
export interface PopupProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly credentialType: CredentialType;
}

/**
 * Static wrong-platform guidance (AD-27; zai-monitor §Platform Binding):
 * derived at render time from (provider = zai, class = auth) — the snapshot
 * error arm carries the class only, so this text lives here, never in the
 * persisted payload (AD-13 intact).
 */
export const ZAI_WRONG_PLATFORM_GUIDANCE =
  'This key may belong to the other platform — check the Z.AI/ZHIPU selection in Settings.';

/**
 * Static honest version for the footer (hito-11). The BrowserApi port has no
 * runtime.getManifest (adding one for a footer string is disproportionate
 * plumbing), so the version lives here as a constant — pinned equal to
 * `public/manifest.json`'s version by a view test that reads the manifest,
 * and bumped together with it at release (0.3.0 lands in the release chore).
 */
export const POPUP_VERSION = 'v0.3.0';

/**
 * Static per-provider settings guidance (popup-ui spec §Settings Guidance):
 * rendered BEFORE each provider's input(s), always present — key-independent
 * — and distinct from validation errors (`state.guidance`, role="alert").
 * English copy is normative per the spec table. The qwen row covers BOTH
 * credentials plus the site selection (hito-8 MODIFIED).
 */
export const SETTINGS_GUIDANCE: Readonly<Record<ProviderId, string>> = {
  qwen:
    'Balance: use an Alibaba Cloud AccessKey pair — Access Key ID and Access Key Secret — created in the ' +
    'Alibaba Cloud Console under RAM → AccessKey pair. The account needs the RAM permission ' +
    'bss:DescribeAcccount. DashScope sk- keys do not work for balance. Plan (optional): a separate ' +
    'inference-only sk-sp- key from the Qwen token-plan service; it probes the international endpoint and ' +
    'each probe costs one 1-token request — NOT the AccessKey pair. Site: international accounts (the ' +
    'default) use the ap-southeast-1 endpoint; china accounts select China.',
  openai: 'Use an admin API key (sk-admin-, read scope) from your organization settings; regular project keys are rejected.',
  kimi: 'Use an API key from the Kimi console; CN and international keys are not interchangeable.',
  zai: 'Use your coding-plan API key — the same key your coding tools use. The platform selector chooses Z.AI (international) or ZHIPU (bigmodel.cn); keys are platform-bound.',
};

/** Everything a render needs — the controller assembles it from stores. */
export interface PopupState {
  /** Active view: main consumption view or the settings (gear) surface. */
  readonly view: 'main' | 'settings';
  readonly providers: readonly PopupProvider[];
  /** Last completed cycle; `undefined` = no cycle completed yet. */
  readonly snapshot: CycleSnapshot | undefined;
  /** Masked credential per provider (`KeyStore.readMaskedCredential`); absent = no stored key. */
  readonly keyStates: Readonly<Partial<Record<ProviderId, MaskedCredential | undefined>>>;
  /** Masked qwen plan key (`qd:key:qwen-plan`); `undefined` = no plan key stored (hito-8). */
  readonly qwenPlanKey: MaskedCredential | undefined;
  /** Last validation message per credential slot, rendered verbatim. */
  readonly guidance: Readonly<Partial<Record<CredentialSlot, string>>>;
  /** Selected ZAI monitor platform (`qd:pref:zai-platform`); the controller reads/persists it. */
  readonly zaiPlatform: ZaiPlatform;
  /** Selected Qwen BSS site (`qd:pref:qwen-site`); the controller reads/persists it. */
  readonly qwenSite: QwenSite;
  /** Chosen badge provider (`qd:pref:badge-provider`); the controller reads/persists it (hito-12 WU-D2). */
  readonly badgeProvider: ProviderId;
  /** Render instant (epoch ms) feeding countdowns — supplied by the controller. */
  readonly nowMs: number;
}

/** Per-class error labels for the main view (AD-21/22). */
const ERROR_CLASS_LABELS: Readonly<Record<ErrorClass, string>> = {
  auth: 'Auth failed',
  'rate-limit': 'Rate limited',
  server: 'Server error',
  network: 'Network error',
  unknown: 'Refresh failed',
};

/**
 * Click-to-choose affordance (hito-12 WU-M2 §Badge Provider Selector,
 * user-ratified Option B): EVERY card hero is wrapped in this static div —
 * the controller's delegated click handler validates the enclosing card's
 * `data-provider` against the shipped slice and writes the badge preference.
 * The settings dropdown stays and writes the SAME store; the controller keeps
 * both paths in sync through one state field. Static strings, never
 * interpolated — no dynamic text enters the affordance markup.
 */
const BADGE_PICK_ACTION = 'set-badge';
const BADGE_PICK_TOOLTIP = 'Show this provider in the toolbar badge';

/**
 * The persistent "this provider owns the toolbar badge" marker (hito-12
 * WU-M2): a chip from the hito-11 chip vocabulary, rendered EXACTLY ONCE per
 * owning card — beside the hero when the live card renders one, beside the
 * provider name otherwise (plan-only, quota-less, failed or frozen-only
 * shapes). Non-owning cards carry no marker: nothing is synthesized.
 */
const BADGE_CHIP = '<span class="chip chip-badge">badge</span>';

/**
 * The card's headline percentage (hito-12 WU-M2 helper): the same precedence
 * the dual hero uses — the ZAI 5h window first, then the qwen token-plan
 * quota; `undefined` when the card has no hero at all. One rule, two
 * consumers (the hero render and the provider-name indicator fallback).
 */
function headlinePercentage(usage: NormalizedUsage): number | undefined {
  return usage.windows?.fiveHour?.percentage ?? usage.quota?.percentage;
}

/**
 * Inline 2px-stroke icons (hito-11): hand-drawn paths, currentColor, no icon
 * font and no remote reference. `aria-hidden` — every use sits beside real
 * text or an aria-label.
 */
function svgIcon(paths: string): string {
  return (
    '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true" focusable="false" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">' +
    paths +
    '</svg>'
  );
}

const ICONS = {
  gear: svgIcon('<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"/>'),
  back: svgIcon('<path d="M20 12H4M10 6l-6 6 6 6"/>'),
  refresh: svgIcon('<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 3v5.5H15"/>'),
  clock: svgIcon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>'),
  calendar: svgIcon('<path d="M4 6h16v15H4zM4 11h16M9 3v4M15 3v4"/>'),
  plug: svgIcon('<path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4"/>'),
  key: svgIcon('<circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v4M20 12v3"/>'),
  shield: svgIcon('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  bolt: svgIcon('<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>'),
  gauge: svgIcon('<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4.5-6.5"/>'),
} as const;

/**
 * Branding footer (popup-ui §Branding Footer + hito-11 honest version):
 * shared markup at the end of both views — real version constant + credit.
 */
function brandingFooter(): string {
  return (
    `<footer class="popup-footer"><span class="version">${POPUP_VERSION}</span> · Built by ` +
    '<a href="https://www.thenorthcode.es/" target="_blank" rel="noreferrer">The North Code</a></footer>'
  );
}

/**
 * Footer tab bar (hito-11 §2-tab nav): exactly QUOTAS + KEYS, wired to the
 * existing open-settings/back data-actions; the active tab carries no action.
 */
function tabBar(view: 'main' | 'settings'): string {
  const tab = (icon: string, label: string, action: 'open-settings' | 'back' | undefined): string =>
    action === undefined
      ? `<button type="button" class="tab tab-active" aria-current="page">${icon}<span>${label}</span></button>`
      : `<button type="button" class="tab" data-action="${action}">${icon}<span>${label}</span></button>`;
  const quotas = tab(ICONS.gauge, 'QUOTAS', view === 'main' ? undefined : 'back');
  const keys = tab(ICONS.key, 'KEYS', view === 'main' ? 'open-settings' : undefined);
  return `<nav class="tabbar" aria-label="Views">${quotas}${keys}</nav>`;
}

/** Escapes the HTML-significant characters; defense-in-depth for provider-sourced text. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('`', '&#96;');
}

/** Full-precision popup rendering of one normalized result (no badge budget). */
export function formatUsageText(usage: NormalizedUsage): string {
  // Optional-value guard (AD-26): monitor results carry no monetary figure —
  // their popup surface is the dedicated monitor block, not this line.
  if (usage.value === undefined) {
    return '';
  }
  const symbol = currencySymbol(usage.currency ?? '') || (usage.currency ?? '');
  return `${symbol}${usage.value.toFixed(2)}`;
}

/**
 * Pure reset countdown (AD-22): whole hours plus ceiling minutes from now to
 * resetAt ("2h 0m", "45m"); an elapsed or due reset collapses to "0m".
 * Windows over 24h render day-granular ("8d 23h 29m" — the qwen token-plan
 * monthly window) while 24h and below keep the hours form. The boundary
 * splits on the RAW remaining time — exactly 24h flips to "1d 0h 0m" but
 * 23h59m59s (which ceils to 1440 minutes) stays in the hours form.
 */
export function formatResetCountdown(resetAt: number, nowMs: number): string {
  const remainingMs = resetAt - nowMs;
  if (remainingMs <= 0) {
    return '0m';
  }
  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  if (remainingMs >= 24 * 3_600_000) {
    const days = Math.floor(remainingMinutes / (24 * 60));
    const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
    const minutes = remainingMinutes % 60;
    return `${days}d ${hours}h ${minutes}m`;
  }
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Frozen-telemetry age chip text (hito-11 LAST KNOWN): whole-minute/hour/day
 * age of a stored success at render time — deterministic over (fetchedAt,
 * state.nowMs), never Date.now(). A future fetchedAt (clock skew) clamps to
 * T-0M; nothing is synthesized beyond the elapsed figure itself.
 */
export function formatKnownAge(fetchedAt: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - fetchedAt) / 60_000));
  if (minutes < 60) {
    return `T-${minutes}M`;
  }
  if (minutes < 2880) {
    return `T-${Math.floor(minutes / 60)}H`;
  }
  return `T-${Math.floor(minutes / 1440)}D`;
}

/** Deterministic plain string order — no locale-dependent collation. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Threshold band classes (popup-ui §Provider List Rendering). */
export type ThresholdBand = 'band-green' | 'band-amber' | 'band-red';

/**
 * Maps a percentage to its threshold band via the ROUNDED displayed value
 * (popup-ui spec — contiguous bands): green below 70, amber at or above 70,
 * red at or above 90. Rounding first means the band can never disagree with
 * the displayed text at .5 boundaries (69.5 displays as 70% → amber).
 */
export function thresholdBand(percentage: number): ThresholdBand {
  const rounded = Math.round(percentage);
  if (rounded < 70) {
    return 'band-green';
  }
  return rounded < 90 ? 'band-amber' : 'band-red';
}

/**
 * Threshold-colored progress bar (popup-ui spec — Fill capped, text
 * uncapped): the visual fill caps at 100; width is presentation only. The
 * primary window's bar additionally carries the same uncapped percentage as
 * a `bar-pct` overlay (hito-6 — the figure renders twice: hero + in-bar).
 * The `bar-ticks` overlay (hito-11) is the segmented 25/50/75/90% notch
 * track — pure presentation, its notches are drawn by popup.css.
 */
function bar(band: ThresholdBand, fillPercent: number, pctLabel?: string): string {
  const width = Math.min(Math.round(fillPercent), 100);
  const ticks = '<span class="bar-ticks" aria-hidden="true"></span>';
  const pct = pctLabel === undefined ? '' : `<span class="bar-pct">${pctLabel}</span>`;
  return `<div class="bar ${band}"><div class="bar-fill" style="width: ${width}%"></div>${ticks}${pct}</div>`;
}

/**
 * One monitor window line (AD-26): used/total (bare total when used is
 * absent, nothing when total is absent too — the live plan-pro shape),
 * countdown when `resetAt` is present, and the percentage — EXCEPT on the
 * primary window, whose percentage lives in the hero figure and the in-bar
 * overlay instead (hito-6: renders exactly twice, so the line keeps only
 * label, used/total and countdown in normal weight below the hero). Absent
 * parts are simply omitted — nothing is synthesized. Percentage-bearing
 * lines carry a threshold bar (popup-ui §Threshold bands); windows without
 * one render the line only. A primary window whose line has no parts left
 * renders just its bar — the number is already on the card twice. The icon
 * (hito-11) adds no text, so every combined-textContent pin survives.
 */
function windowLine(label: string, window: UsageWindow, state: PopupState, primary = false, icon = ''): string {
  const parts: string[] = [];
  if (window.percentage !== undefined && !primary) {
    parts.push(`${Math.round(window.percentage)}%`);
  }
  if (window.used !== undefined) {
    parts.push(`${window.used} / ${window.total}`);
  } else if (window.total !== undefined) {
    parts.push(`${window.total} total`);
  }
  if (window.resetAt !== undefined) {
    // Prominent countdown (popup-ui §Provider List Rendering): a distinct
    // inline element inside the line — the combined textContent of the <p>
    // is unchanged, so pinned combined-text assertions keep holding.
    parts.push(`Resets in <span class="countdown">${formatResetCountdown(window.resetAt, state.nowMs)}</span>`);
  }
  const line = parts.length === 0 ? '' : `<p class="monitor-window">${icon}${label}: ${parts.join(' · ')}</p>`;
  if (window.percentage === undefined) {
    return line;
  }
  return line + bar(thresholdBand(window.percentage), window.percentage, primary ? `${Math.round(window.percentage)}%` : undefined);
}

/** ZAI monitor block: level, 5h/weekly windows, monthly MCP + per-tool rows (AD-26/27). */
function monitorBlock(usage: NormalizedUsage, state: PopupState): string {
  const windows = usage.windows!;
  const parts: string[] = ['<div class="monitor">'];
  if (windows.level !== undefined) {
    parts.push(`<p class="monitor-level">Level: ${escapeHtml(windows.level)}</p>`);
  }
  if (windows.fiveHour !== undefined) {
    parts.push(windowLine('5h', windows.fiveHour, state, true, ICONS.bolt)); // primary window (hito-6)
  }
  if (windows.weekly !== undefined) {
    parts.push(windowLine('Weekly', windows.weekly, state, false, ICONS.calendar));
  }
  if (windows.mcp !== undefined) {
    // Monthly MCP window (hito-11): the MONTHLY chip states the real cadence —
    // the design mock's "PER MIN" label would be a lie.
    parts.push(`<p class="monitor-mcp">${ICONS.plug}MCP: ${windows.mcp.used} / ${windows.mcp.ceiling}<span class="chip chip-mcp">MONTHLY</span></p>`);
    // MCP fill derives from used/ceiling at render time (popup-ui spec —
    // MCP bar from used/ceiling): presentation only, NO percentage is
    // synthesized for the window itself.
    const fill = (windows.mcp.used / windows.mcp.ceiling) * 100;
    parts.push(bar(thresholdBand(fill), fill));
    if (windows.mcp.tools.length > 0) {
      const tools = [...windows.mcp.tools].sort((a, b) => compareStrings(a.name, b.name));
      const rows = tools.map((tool) => `<li class="mcp-tool">${escapeHtml(tool.name)} · ${tool.used}</li>`);
      parts.push(`<ul class="mcp-tools">${rows.join('')}</ul>`);
    }
  }
  parts.push('</div>');
  return parts.join('');
}

/** OpenAI per-model rows, sorted by (model, usageType) for determinism (AD-22). */
function modelRows(usage: NormalizedUsage): string {
  const sorted = [...(usage.breakdown as readonly LineItem[])].sort((a, b) =>
    a.model !== b.model ? compareStrings(a.model, b.model) : compareStrings(a.usageType, b.usageType),
  );
  const symbol = currencySymbol(usage.currency ?? '') || (usage.currency ?? '');
  const items = sorted.map(
    (row) =>
      `<li class="model-row">${escapeHtml(row.model)} · ${escapeHtml(row.usageType)} — ${symbol}${row.value.toFixed(2)}</li>`,
  );
  return `<ul class="model-rows">${items.join('')}</ul>`;
}

/**
 * Qwen plan line (popup-ui §Qwen Plan Line, hito-8): normal weight below the
 * balance, one of the three status texts; exhausted renders the countdown
 * (via the pure `formatResetCountdown`, a distinct `.countdown` element like
 * the monitor windows) only when a reset instant exists — an unparseable 429
 * degrades to the bare status, nothing is synthesized. `Plan: Available`
 * capitalizes the positive status; the two failure forms stay lowercase per
 * the spec table.
 */
function planLine(plan: PlanInfo, state: PopupState): string {
  if (plan.status === 'available') {
    return '<p class="plan-status">Plan: Available</p>';
  }
  if (plan.status === 'key-rejected') {
    return '<p class="plan-status">Plan: key rejected</p>';
  }
  if (plan.resetAt === undefined) {
    return '<p class="plan-status">Plan: exhausted</p>';
  }
  const countdown = formatResetCountdown(plan.resetAt, state.nowMs);
  return `<p class="plan-status">Plan: exhausted · resets in <span class="countdown">${countdown}</span></p>`;
}

/**
 * Qwen token-plan quota monitor block (popup-ui §Qwen Token Plan Quota Line,
 * hito-12 WU-M twin-card rule — user-ratified visual copy of the ZAI monitor
 * card, supersedes the WU-D3 line-only render): the quota percentage lives in
 * the card hero (usageBody) and again inside this bar's `bar-pct` overlay —
 * the hito-6 dual-hero discipline verbatim, INCLUDING the fill cap at 100
 * while the figure stays uncapped (127.3 renders 127 in text, 100% width).
 * The line below therefore carries no figure at all — exactly what the ZAI
 * 5h line lost — and keeps the window-label vocabulary: `Token Plan: Resets
 * in <countdown>` via the SAME pure `formatResetCountdown` discipline,
 * rendered as the established `.countdown` element. A percentage-only quota
 * leaves the line with no parts, so the bar renders alone (the windowLine
 * discipline — the number is already on the card twice); a reset instant
 * without a percentage renders the line WITHOUT a bar (mirrors ZAI's
 * absent-pct window); a quota carrying neither field renders NO block —
 * nothing is synthesized. The block sits below the balance and ABOVE the
 * binary plan line; the two coexist independently.
 */
function quotaMonitorBlock(quota: TokenPlanQuota, state: PopupState): string {
  const line =
    quota.resetAt !== undefined
      ? `<p class="monitor-window">${ICONS.clock}Token Plan: Resets in <span class="countdown">${formatResetCountdown(quota.resetAt, state.nowMs)}</span></p>`
      : '';
  if (quota.percentage === undefined) {
    // Honest absent: no hero, no bar — the resets line only (a quota
    // carrying neither field renders no block at all, pinned in view tests).
    return line === '' ? '' : `<div class="monitor">${line}</div>`;
  }
  // Same bar the primary ZAI window builds: band from the rounded displayed
  // percentage, fill capped at 100, the uncapped rounded figure inside it.
  const barMarkup = bar(thresholdBand(quota.percentage), quota.percentage, `${Math.round(quota.percentage)}%`);
  return `<div class="monitor">${line}${barMarkup}</div>`;
}

/**
 * The ok-arm card body (hero, balance, quota, plan, tier, monitor, breakdown) —
 * shared by the live ok entry and the LAST KNOWN frozen render (hito-11),
 * so a stale card shows exactly what the live card would have shown. The
 * quota monitor block (hito-12 WU-M) ports into this body: it travels with
 * the usage it belongs to, frozen LAST KNOWN renders included.
 */
function usageBody(usage: NormalizedUsage, state: PopupState, badgeHero = false): string {
  const parts: string[] = [];
  // Dual hero percentage (hito-6 §Provider List Rendering): where a card's
  // primary percentage exists it renders as the card's largest, boldest
  // element ABOVE all other card content, colored by its threshold band
  // (hito-11); the same number repeats inside its threshold bar. Sources:
  // ZAI's 5h window, or — hito-12 WU-M twin-card rule, user-ratified — the
  // qwen token-plan quota percentage. Precedence is windows.fiveHour first,
  // then quota: a card never has two heroes and nothing is synthesized when
  // both are absent (a plan-only or quota-less qwen stays hero-free, the
  // balance remaining the leading figure). Every hero sits inside the
  // click-to-choose wrapper (hito-12 WU-M2), and the badge-owning card's
  // hero row additionally carries the chip marker (only for LIVE bodies —
  // frozen LAST KNOWN renders never take the marker, the name row owns it).
  const heroPercentage = headlinePercentage(usage);
  if (heroPercentage !== undefined) {
    const hero = `<p class="hero-percentage ${thresholdBand(heroPercentage)}">${Math.round(heroPercentage)}%</p>`;
    parts.push(
      `<div class="hero-pick" data-action="${BADGE_PICK_ACTION}" title="${BADGE_PICK_TOOLTIP}">${hero}${badgeHero ? BADGE_CHIP : ''}</div>`,
    );
  }
  parts.push(`<p class="usage">${formatUsageText(usage)}</p>`);
  if (usage.quota !== undefined) {
    parts.push(quotaMonitorBlock(usage.quota, state)); // hito-12 WU-M: hero lives above, bar + resets line here
  }
  if (usage.plan !== undefined) {
    parts.push(planLine(usage.plan, state)); // hito-8: below the balance
  }
  if (usage.tier !== undefined) {
    parts.push(`<p class="tier">Tier: ${escapeHtml(usage.tier)}</p>`);
  }
  if (usage.windows !== undefined) {
    parts.push(monitorBlock(usage, state));
  }
  if (usage.breakdown !== undefined && usage.breakdown.length > 0) {
    parts.push(modelRows(usage));
  }
  return parts.join('');
}

/**
 * LAST KNOWN (frozen) block (hito-11): when the live cycle entry is an error
 * and the snapshot carries a last-known success for the provider, render the
 * real stale usage dimmed under a `LAST KNOWN · T-<age>` chip. The age is
 * derived from (entry.fetchedAt, state.nowMs) — deterministic input, never
 * Date.now(). No lastKnown entry → no block: nothing is synthesized.
 */
function lastKnownBlock(known: NormalizedUsage, state: PopupState): string {
  const chip = `<span class="chip chip-known">${ICONS.clock}LAST KNOWN · ${formatKnownAge(known.fetchedAt, state.nowMs)}</span>`;
  return `<div class="last-known">${chip}${usageBody(known, state)}</div>`;
}

function providerMainSection(provider: PopupProvider, state: PopupState): string {
  const entry = state.snapshot?.results[provider.id];
  // Card wrapper (popup-ui §Provider List Rendering): one card per provider —
  // ok results and error cards share the same structure; the error card adds
  // the `card-error` marker for the AUTH-FAILED-style treatment (hito-11).
  const error = entry !== undefined && entry.status === 'error';
  // Badge marker rule (hito-12 WU-M2): the owning card carries the chip EXACTLY
  // ONCE — beside its live hero when one renders, beside the provider name
  // otherwise (plan-only, quota-less, failed with a frozen hero, or no-cycle).
  // Chosen-without-data stays honest: the marker names the preference, not a
  // figure, and nothing else is synthesized.
  const badgeHero =
    provider.id === state.badgeProvider &&
    entry !== undefined &&
    entry.status === 'ok' &&
    headlinePercentage(entry.usage) !== undefined;
  const nameChip = provider.id === state.badgeProvider && !badgeHero ? BADGE_CHIP : '';
  const parts: string[] = [
    `<section class="provider card${error ? ' card-error' : ''}" data-provider="${provider.id}">`,
  ];
  parts.push(`<h2 class="provider-name">${escapeHtml(provider.displayName)}${nameChip}</h2>`);
  if (entry === undefined) {
    parts.push('<p class="no-cycle">No cycle data yet</p>');
  } else if (entry.status === 'error') {
    parts.push(`<p class="refresh-error" role="status">${ERROR_CLASS_LABELS[entry.errorClass]}</p>`);
    // Wrong-platform guidance (AD-27): static, derived from (zai, auth) at
    // render time — the snapshot carries the class only.
    if (provider.id === 'zai' && entry.errorClass === 'auth') {
      parts.push(`<p class="guidance" role="alert">${escapeHtml(ZAI_WRONG_PLATFORM_GUIDANCE)}</p>`);
    }
    const known = state.snapshot?.lastKnown?.[provider.id];
    if (known !== undefined) {
      parts.push(lastKnownBlock(known.usage, state));
    }
  } else {
    parts.push(usageBody(entry.usage, state, badgeHero)); // WU-M2: the owning live hero carries the marker
  }
  parts.push('</section>');
  return parts.join('');
}

/** Real plan chip (hito-11): PLAN · <level> from the LIVE ZAI ok entry only. */
function planChip(state: PopupState): string {
  const entry = state.snapshot?.results.zai;
  const level = entry !== undefined && entry.status === 'ok' ? entry.usage.windows?.level : undefined;
  if (level === undefined) {
    return ''; // no live level → no chip (the design's static LIVE badge never ships)
  }
  return `<span class="chip chip-plan">${ICONS.shield}PLAN · ${escapeHtml(level)}</span>`;
}

/** Renders the consumption view; deterministic for identical state. */
export function renderMain(state: PopupState): string {
  // Keyless filtering (hito-6 §Provider List Rendering): one card per
  // provider WITH a stored credential — keyless providers render no card
  // ("No cycle data yet" noise dies); the settings view keeps everyone. A
  // qwen card keys on EITHER qwen credential (hito-8 §Qwen Plan Line): the
  // AK/SK pair or the plan key alone.
  const keyedProviders = state.providers.filter((provider) =>
    provider.id === 'qwen'
      ? state.keyStates.qwen !== undefined || state.qwenPlanKey !== undefined
      : state.keyStates[provider.id] !== undefined,
  );
  const sections = keyedProviders.map((provider) => providerMainSection(provider, state)).join('\n');
  const header =
    '<header class="popup-header"><div class="brand"><h1>quotadeck</h1>' +
    planChip(state) +
    '</div><div class="header-actions">' +
    `<button type="button" class="header-action" data-action="refresh" aria-label="Refresh now">${ICONS.refresh}</button>` +
    `<button type="button" class="header-action" data-action="open-settings" aria-label="Open settings">${ICONS.gear}</button>` +
    '</div></header>';
  return `${header}\n${sections}\n${tabBar('main')}\n${brandingFooter()}`;
}

/** Masked display lines: one per secret part — both parts for the qwen pair (AD-17). */
function maskedLines(masked: MaskedCredential): string[] {
  return masked.type === 'ak-sk'
    ? [
        `<p class="key-state">AccessKeyId: ${escapeHtml(masked.maskedAccessKeyId)}</p>`,
        `<p class="key-state">AccessKeySecret: ${escapeHtml(masked.maskedAccessKeySecret)}</p>`,
      ]
    : [`<p class="key-state">Stored key: ${escapeHtml(masked.maskedToken)}</p>`];
}

/**
 * One labeled credential field row: the label sits above its OWN full-width
 * input (user-reported squeeze fix) — never two fields sharing a row.
 */
function credentialField(providerId: string, suffix: string, label: string, name: string, placeholder: string): string {
  return (
    '<div class="credential-field">' +
    `<label for="key-input-${providerId}-${suffix}">${label}</label>` +
    `<input type="password" autocomplete="off" id="key-input-${providerId}-${suffix}" name="${name}" placeholder="${placeholder}" />` +
    '</div>'
  );
}

/** Credential inputs: TWO password fields for the ak-sk pair, one otherwise (AD-17). */
function credentialInputs(provider: PopupProvider): string {
  if (provider.credentialType === 'ak-sk') {
    // Stacked pair (user-reported squeeze fix): Access Key ID on its own
    // labeled line, then Access Key Secret — labels above their own
    // full-width fields so nothing truncates.
    return (
      credentialField(provider.id, 'ak', 'Access Key ID', 'accessKeyId', 'AccessKeyId') +
      credentialField(provider.id, 'sk', 'Access Key Secret', 'accessKeySecret', 'AccessKeySecret')
    );
  }
  return `<input type="password" autocomplete="off" id="key-input-${provider.id}" name="credential" placeholder="Credential" />`;
}

/** Save + revoke controls; the ak-sk pair stacks them on their own row after the fields. */
function credentialActions(provider: PopupProvider): string {
  const buttons =
    `<button type="submit" id="key-add-${provider.id}">Save key</button>` +
    `<button type="button" class="revoke" id="key-revoke-${provider.id}" data-revoke="${provider.id}">Revoke</button>`;
  if (provider.credentialType === 'ak-sk') {
    return `<div class="form-actions">${buttons}</div>`;
  }
  return buttons;
}

/**
 * ZAI platform selector (AD-28; popup-ui §ZAI Platform Selector): rendered
 * from the pure ZAI_PLATFORMS table — labels are display strings, never
 * secret material, so they render unmasked. The current preference carries
 * the `selected` attribute; the controller persists changes.
 */
function platformSelector(state: PopupState): string {
  const options = ZAI_PLATFORMS.map(
    (platform) =>
      `<option value="${platform.id}"${platform.id === state.zaiPlatform ? ' selected' : ''}>${escapeHtml(platform.label)}</option>`,
  ).join('');
  return (
    '<div class="platform-field">' +
    '<label for="zai-platform-select">Platform</label>' +
    `<select id="zai-platform-select" data-action="zai-platform">${options}</select>` +
    '</div>'
  );
}

/**
 * Qwen site selector (popup-ui §Qwen Site Selector; AD-28 mirror): rendered
 * from the pure QWEN_SITES table — the labels are display strings (the
 * international option names itself the default), never secret material, so
 * they render unmasked. The current preference carries the `selected`
 * attribute; the controller persists changes.
 */
function siteSelector(state: PopupState): string {
  const options = QWEN_SITES.map(
    (site) =>
      `<option value="${site.id}"${site.id === state.qwenSite ? ' selected' : ''}>${escapeHtml(site.label)}</option>`,
  ).join('');
  return (
    '<div class="site-field">' +
    '<label for="qwen-site-select">Site</label>' +
    `<select id="qwen-site-select" data-action="qwen-site">${options}</select>` +
    '</div>'
  );
}

/**
 * Badge provider selector (popup-ui §Badge Provider Selector; hito-12 WU-D2):
 * rendered data-driven from the provider list the controller composes (the
 * SHIPPED slice in production) — labels are display names, never secret
 * material, so they render unmasked. The current choice carries the
 * `selected` attribute; the controller persists changes through the
 * badge-provider store.
 */
function badgeProviderSelector(state: PopupState): string {
  const options = state.providers
    .map(
      (provider) =>
        `<option value="${provider.id}"${provider.id === state.badgeProvider ? ' selected' : ''}>${escapeHtml(provider.displayName)}</option>`,
    )
    .join('');
  return (
    '<div class="badge-provider-field">' +
    '<label for="badge-provider-select">Badge provider</label>' +
    `<select id="badge-provider-select" data-action="badge-provider">${options}</select>` +
    '</div>'
  );
}

/**
 * Qwen plan key group (popup-ui §Qwen Plan Key Settings Group, hito-8): the
 * SECOND qwen field group — its own password input, save and revoke
 * controls, labeled `Plan key (sk-sp-)` and revoked via the plan slot
 * (`data-revoke="qwen-plan"`), independent of the AK/SK pair above it. The
 * masked state renders inside the group; the controller owns persistence.
 * Stacked like the pair (user-reported squeeze fix): the label owns a row
 * above its full-width field and the controls sit on their own row — the
 * group shares the `.key-form` flex row that squeezed them side by side.
 */
function planKeyGroup(state: PopupState): string {
  const masked = state.qwenPlanKey;
  const maskedLine =
    masked !== undefined && masked.type !== 'ak-sk'
      ? `<p class="key-state">Plan key: ${escapeHtml(masked.maskedToken)}</p>`
      : '';
  return (
    maskedLine +
    '<form class="key-form plan-key-form" data-provider="qwen-plan">' +
    '<div class="credential-field">' +
    '<label for="key-input-qwen-plan">Plan key (sk-sp-)</label>' +
    '<input type="password" autocomplete="off" id="key-input-qwen-plan" name="credential" placeholder="sk-sp-..." />' +
    '</div>' +
    '<div class="form-actions">' +
    '<button type="submit" id="key-add-qwen-plan">Save plan key</button>' +
    '<button type="button" class="revoke" id="key-revoke-qwen-plan" data-revoke="qwen-plan">Revoke plan key</button>' +
    '</div>' +
    '</form>'
  );
}

function providerSettingsSection(provider: PopupProvider, state: PopupState): string {
  const masked = state.keyStates[provider.id];
  const guidance = state.guidance[provider.id];
  const parts: string[] = [`<section class="provider card" data-provider="${provider.id}">`];
  parts.push(`<h2 class="provider-name">${escapeHtml(provider.displayName)}</h2>`);
  if (masked !== undefined) {
    parts.push(...maskedLines(masked));
  }
  // Static settings guidance (popup-ui §Settings Guidance): ALWAYS rendered
  // before the inputs — key-independent — and distinct from validation errors.
  parts.push(`<p class="settings-guidance">${escapeHtml(SETTINGS_GUIDANCE[provider.id])}</p>`);
  parts.push(
    `<form class="key-form" data-provider="${provider.id}">` +
      credentialInputs(provider) +
      credentialActions(provider) +
      '</form>',
  );
  if (provider.id === 'zai') {
    parts.push(platformSelector(state));
  }
  if (provider.id === 'qwen') {
    parts.push(siteSelector(state));
    parts.push(planKeyGroup(state)); // second field group (hito-8 dual credential)
  }
  if (guidance !== undefined) {
    parts.push(`<p class="guidance" role="alert">${escapeHtml(guidance)}</p>`);
  }
  if (provider.id === 'qwen' && state.guidance['qwen-plan'] !== undefined) {
    // Plan-slot validation guidance, rendered after the group it belongs to —
    // separate content from the static per-provider copy above.
    parts.push(`<p class="guidance" role="alert">${escapeHtml(state.guidance['qwen-plan'])}</p>`);
  }
  parts.push('</section>');
  return parts.join('');
}

/** Renders the settings (gear) view; deterministic for identical state. */
export function renderSettings(state: PopupState): string {
  const sections = state.providers.map((provider) => providerSettingsSection(provider, state)).join('\n');
  const header =
    '<header class="popup-header"><div class="brand"><h1>Settings</h1></div>' +
    '<div class="header-actions">' +
    `<button type="button" class="header-action" data-action="back" aria-label="Back to quotas">${ICONS.back}</button>` +
    '</div></header>';
  // Badge provider selector (hito-12 WU-D2) opens the settings view — the
  // first block under the header, before the provider sections.
  return `${header}\n${badgeProviderSelector(state)}\n${sections}\n${tabBar('settings')}\n${brandingFooter()}`;
}
