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
//   settings — wired by the controller's click delegation.
// - Main view: one provider CARD per KEYED provider in PopupState.providers
//   order (PROVIDER_METADATA order in production, AD-6) — keyless providers
//   render no card at all (hito-6); the settings view keeps every provider.
//   The main header carries the refresh affordance
//   (`data-action="refresh"`, hito-6 §Manual Refresh Control) next to the
//   gear. ZAI renders its monitor block from `usage.windows` (plan level,
//   5h/weekly windows with the percentage uncapped, used/total, countdown
//   via the pure `formatResetCountdown` from `windows.*.resetAt` rendered
//   as a distinct `.countdown` element, and the monthly MCP window with
//   per-tool rows); where a card's primary percentage exists (ZAI: the 5h
//   window) it renders TWICE — as the card's largest, boldest element
//   (`.hero-percentage`) above all other card content, and as the same
//   number inside its threshold bar (`.bar-pct`) — while secondary info
//   (window label, used/total, countdown) stays in normal weight below;
//   every percentage-bearing window and the MCP window carry a
//   threshold-colored bar (`band-green|band-amber|band-red`, contiguous
//   bands from the rounded displayed percentage; visual fill caps at 100
//   while percentage text stays uncapped; MCP fill derives from
//   used/ceiling — presentation only, never a synthesized percentage);
//   OpenAI renders per-model rows from `usage.breakdown` sorted by
//   (model, usageType) for determinism; failed providers render a
//   per-class error label inside the same card structure (AD-21), and a ZAI
//   auth failure additionally surfaces the static wrong-platform guidance
//   (AD-27 — derived here from (provider, class), never transported in the
//   snapshot). NO key forms appear in the main view — key state and forms
//   live in settings only.
// - Settings view: each provider section renders its static SETTINGS_GUIDANCE
//   copy (popup-ui §Settings Guidance) before its input(s) — key-independent
//   and distinct from validation errors. The ZAI section carries the
//   platform selector (AD-28), rendered from the pure ZAI_PLATFORMS table
//   with unmasked labels and the current preference marked `selected`; the
//   qwen section carries the site selector (popup-ui §Qwen Site Selector)
//   from the pure QWEN_SITES table the same way; the controller owns
//   persistence for both.
// - Both views end with the shared branding footer (popup-ui §Branding
//   Footer): "Built by The North Code" → https://www.thenorthcode.es/.
// - Every dynamic string is escaped (AD-3 spirit): provider-sourced levels,
//   tool names, model names, guidance messages and masked keys all pass
//   escapeHtml.
// - The view renders exactly the masked forms it is given; full keys never
//   reach this module (AD-15).
import type { CredentialType, ProviderId } from '../core/provider';
import type { QwenSite } from '../core/qwen-sites';
import { QWEN_SITES } from '../core/qwen-sites';
import type { ErrorClass } from '../refresh/error-taxonomy';
import { currencySymbol, type LineItem, type NormalizedUsage, type PlanInfo, type UsageWindow } from '../core/usage';
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
 * Branding footer (popup-ui §Branding Footer): shared markup at the end of
 * both views — a plain anchor suffices per spec.
 */
const BRANDING_FOOTER =
  '<footer class="popup-footer">Built by <a href="https://www.thenorthcode.es/" target="_blank" rel="noreferrer">The North Code</a></footer>';

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
 */
export function formatResetCountdown(resetAt: number, nowMs: number): string {
  const remainingMinutes = Math.ceil((resetAt - nowMs) / 60_000);
  if (remainingMinutes <= 0) {
    return '0m';
  }
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
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
 */
function bar(band: ThresholdBand, fillPercent: number, pctLabel?: string): string {
  const width = Math.min(Math.round(fillPercent), 100);
  const pct = pctLabel === undefined ? '' : `<span class="bar-pct">${pctLabel}</span>`;
  return `<div class="bar ${band}"><div class="bar-fill" style="width: ${width}%"></div>${pct}</div>`;
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
 * renders just its bar — the number is already on the card twice.
 */
function windowLine(label: string, window: UsageWindow, state: PopupState, primary = false): string {
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
  const line = parts.length === 0 ? '' : `<p class="monitor-window">${label}: ${parts.join(' · ')}</p>`;
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
    parts.push(windowLine('5h', windows.fiveHour, state, true)); // primary window (hito-6)
  }
  if (windows.weekly !== undefined) {
    parts.push(windowLine('Weekly', windows.weekly, state));
  }
  if (windows.mcp !== undefined) {
    parts.push(`<p class="monitor-mcp">MCP: ${windows.mcp.used} / ${windows.mcp.ceiling}</p>`);
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

function providerMainSection(provider: PopupProvider, state: PopupState): string {
  const entry = state.snapshot?.results[provider.id];
  // Card wrapper (popup-ui §Provider List Rendering): one card per provider —
  // ok results and error cards share the same structure.
  const parts: string[] = [`<section class="provider card" data-provider="${provider.id}">`];
  parts.push(`<h2 class="provider-name">${escapeHtml(provider.displayName)}</h2>`);
  if (entry === undefined) {
    parts.push('<p class="no-cycle">No cycle data yet</p>');
  } else if (entry.status === 'error') {
    parts.push(`<p class="refresh-error" role="status">${ERROR_CLASS_LABELS[entry.errorClass]}</p>`);
    // Wrong-platform guidance (AD-27): static, derived from (zai, auth) at
    // render time — the snapshot carries the class only.
    if (provider.id === 'zai' && entry.errorClass === 'auth') {
      parts.push(`<p class="guidance" role="alert">${escapeHtml(ZAI_WRONG_PLATFORM_GUIDANCE)}</p>`);
    }
  } else {
    // Dual hero percentage (hito-6 §Provider List Rendering): where a card's
    // primary percentage exists (ZAI: the 5h window), it renders as the
    // card's largest, boldest element ABOVE all other card content; the same
    // number repeats inside its threshold bar. Monetary cards have no
    // primary percentage — their balance stays the leading figure, and no
    // percentage is ever synthesized for them.
    const heroPercentage = entry.usage.windows?.fiveHour?.percentage;
    if (heroPercentage !== undefined) {
      parts.push(`<p class="hero-percentage">${Math.round(heroPercentage)}%</p>`);
    }
    parts.push(`<p class="usage">${formatUsageText(entry.usage)}</p>`);
    if (entry.usage.plan !== undefined) {
      parts.push(planLine(entry.usage.plan, state)); // hito-8: below the balance
    }
    if (entry.usage.tier !== undefined) {
      parts.push(`<p class="tier">Tier: ${escapeHtml(entry.usage.tier)}</p>`);
    }
    if (entry.usage.windows !== undefined) {
      parts.push(monitorBlock(entry.usage, state));
    }
    if (entry.usage.breakdown !== undefined && entry.usage.breakdown.length > 0) {
      parts.push(modelRows(entry.usage));
    }
  }
  parts.push('</section>');
  return parts.join('');
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
    '<header class="popup-header"><h1>quotadeck</h1><div class="header-actions">' +
    '<button type="button" class="header-action" data-action="refresh">Refresh</button>' +
    '<button type="button" class="header-action" data-action="open-settings">Settings</button>' +
    '</div></header>';
  return `${header}\n${sections}\n${BRANDING_FOOTER}`;
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

/** Credential inputs: TWO password fields for the ak-sk pair, one otherwise (AD-17). */
function credentialInputs(provider: PopupProvider): string {
  if (provider.credentialType === 'ak-sk') {
    return (
      `<input type="password" autocomplete="off" id="key-input-${provider.id}-ak" name="accessKeyId" placeholder="AccessKeyId" />` +
      `<input type="password" autocomplete="off" id="key-input-${provider.id}-sk" name="accessKeySecret" placeholder="AccessKeySecret" />`
    );
  }
  return `<input type="password" autocomplete="off" id="key-input-${provider.id}" name="credential" placeholder="Credential" />`;
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
    '<label for="key-input-qwen-plan">Plan key (sk-sp-)</label>' +
    '<input type="password" autocomplete="off" id="key-input-qwen-plan" name="credential" placeholder="sk-sp-..." />' +
    '<button type="submit" id="key-add-qwen-plan">Save plan key</button>' +
    '<button type="button" class="revoke" id="key-revoke-qwen-plan" data-revoke="qwen-plan">Revoke plan key</button>' +
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
      `<button type="submit" id="key-add-${provider.id}">Save key</button>` +
      `<button type="button" class="revoke" id="key-revoke-${provider.id}" data-revoke="${provider.id}">Revoke</button>` +
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
    '<header class="popup-header"><h1>Settings</h1>' +
    '<button type="button" class="header-action" data-action="back">Back</button></header>';
  return `${header}\n${badgeProviderSelector(state)}\n${sections}\n${BRANDING_FOOTER}`;
}
