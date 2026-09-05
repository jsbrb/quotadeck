// Popup view (popup-ui spec §Settings Gear Surface, §Per-Model Consumption
// View; AD-11/AD-22) — pure string-producing functions only. No DOM, no I/O,
// and no imports beyond core/storage types and the usage helpers, so
// node-environment tests pin determinism with strict string equality.
//
// Rendering contract (AD-22):
// - Two views: `renderMain` (default consumption view) and `renderSettings`
//   (all key management). The header of each carries the switch — a
//   `data-action="open-settings"` gear on main, `data-action="back"` on
//   settings — wired by the controller's click delegation.
// - Main view: one <section> per provider in PopupState.providers order
//   (PROVIDER_METADATA order in production, AD-6). ZAI renders its budget
//   block (percent, used/limit, tier, countdown via the pure
//   `formatResetCountdown` — the countdown line is simply omitted when the
//   report has no resetAt); OpenAI renders per-model rows from
//   `usage.breakdown` sorted by (model, usageType) for determinism; failed
//   providers render a per-class error label (AD-21). NO key forms appear in
//   the main view — key state and forms live in settings only.
// - Every dynamic string is escaped (AD-3 spirit): provider-sourced tiers,
//   model names, guidance messages and masked keys all pass escapeHtml.
// - The view renders exactly the masked forms it is given; full keys never
//   reach this module (AD-15).
import type { CredentialType, ProviderId } from '../core/provider';
import type { ErrorClass } from '../refresh/error-taxonomy';
import { currencySymbol, type LineItem, type NormalizedUsage } from '../core/usage';
import type { MaskedCredential } from '../storage/key-store';
import type { CycleSnapshot } from '../storage/snapshot-store';

/** Provider metadata the view needs; supplied from PROVIDER_METADATA (AD-24). */
export interface PopupProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly credentialType: CredentialType;
}

/** Everything a render needs — the controller assembles it from stores. */
export interface PopupState {
  /** Active view: main consumption view or the settings (gear) surface. */
  readonly view: 'main' | 'settings';
  readonly providers: readonly PopupProvider[];
  /** Last completed cycle; `undefined` = no cycle completed yet. */
  readonly snapshot: CycleSnapshot | undefined;
  /** Masked credential per provider (`KeyStore.readMaskedCredential`); absent = no stored key. */
  readonly keyStates: Readonly<Partial<Record<ProviderId, MaskedCredential | undefined>>>;
  /** Last validation message per provider, rendered verbatim. */
  readonly guidance: Readonly<Partial<Record<ProviderId, string>>>;
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
  const symbol = currencySymbol(usage.currency) || usage.currency;
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

/** ZAI budget block: percent + used/limit summary, countdown when present (AD-22). */
function budgetBlock(usage: NormalizedUsage, state: PopupState): string {
  const budget = usage.budget!;
  const summary =
    budget.percent !== undefined && budget.limit !== undefined
      ? `Budget: ${budget.percent}% of ${budget.limit} (${budget.used} used)`
      : `Budget: ${budget.used} used`;
  const parts = [`<p class="budget-summary">${summary}</p>`];
  if (budget.resetAt !== undefined) {
    parts.push(`<p class="budget-reset">Resets in ${formatResetCountdown(budget.resetAt, state.nowMs)}</p>`);
  }
  return `<div class="budget">${parts.join('')}</div>`;
}

/** OpenAI per-model rows, sorted by (model, usageType) for determinism (AD-22). */
function modelRows(usage: NormalizedUsage): string {
  const sorted = [...(usage.breakdown as readonly LineItem[])].sort((a, b) =>
    a.model !== b.model ? compareStrings(a.model, b.model) : compareStrings(a.usageType, b.usageType),
  );
  const symbol = currencySymbol(usage.currency) || usage.currency;
  const items = sorted.map(
    (row) =>
      `<li class="model-row">${escapeHtml(row.model)} · ${escapeHtml(row.usageType)} — ${symbol}${row.value.toFixed(2)}</li>`,
  );
  return `<ul class="model-rows">${items.join('')}</ul>`;
}

function providerMainSection(provider: PopupProvider, state: PopupState): string {
  const entry = state.snapshot?.results[provider.id];
  const parts: string[] = [`<section class="provider" data-provider="${provider.id}">`];
  parts.push(`<h2 class="provider-name">${escapeHtml(provider.displayName)}</h2>`);
  if (entry === undefined) {
    parts.push('<p class="no-cycle">No cycle data yet</p>');
  } else if (entry.status === 'error') {
    parts.push(`<p class="refresh-error" role="status">${ERROR_CLASS_LABELS[entry.errorClass]}</p>`);
  } else {
    parts.push(`<p class="usage">${formatUsageText(entry.usage)}</p>`);
    if (entry.usage.tier !== undefined) {
      parts.push(`<p class="tier">Tier: ${escapeHtml(entry.usage.tier)}</p>`);
    }
    if (entry.usage.budget !== undefined) {
      parts.push(budgetBlock(entry.usage, state));
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
  const sections = state.providers.map((provider) => providerMainSection(provider, state)).join('\n');
  const header =
    '<header class="popup-header"><h1>quotadeck</h1>' +
    '<button type="button" class="header-action" data-action="open-settings">Settings</button></header>';
  return `${header}\n${sections}`;
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

function providerSettingsSection(provider: PopupProvider, state: PopupState): string {
  const masked = state.keyStates[provider.id];
  const guidance = state.guidance[provider.id];
  const parts: string[] = [`<section class="provider" data-provider="${provider.id}">`];
  parts.push(`<h2 class="provider-name">${escapeHtml(provider.displayName)}</h2>`);
  if (masked !== undefined) {
    parts.push(...maskedLines(masked));
  }
  parts.push(
    `<form class="key-form" data-provider="${provider.id}">` +
      credentialInputs(provider) +
      `<button type="submit" id="key-add-${provider.id}">Save key</button>` +
      `<button type="button" class="revoke" id="key-revoke-${provider.id}" data-revoke="${provider.id}">Revoke</button>` +
      '</form>',
  );
  if (guidance !== undefined) {
    parts.push(`<p class="guidance" role="alert">${escapeHtml(guidance)}</p>`);
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
  return `${header}\n${sections}`;
}
