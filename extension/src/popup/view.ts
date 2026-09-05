// Popup view (popup-ui spec §Provider List Rendering, §Masked Key Display;
// AD-11) — pure string-producing functions only. No DOM, no I/O, no imports
// beyond core/storage types and the usage helpers, so node-environment tests
// can pin determinism with strict string equality.
//
// Rendering contract:
// - One <section> per registered provider, in the order `PopupState.providers`
//   supplies (registry order in production, AD-6).
// - Per-provider outcome: ok entry → usage value + currency (and tier ONLY
//   when the normalized result includes one); error entry → error indication
//   with no usage; absent entry or no snapshot → the no-cycle note.
// - Every dynamic string is escaped (AD-3 spirit): `tier` is fixture-sourced,
//   guidance messages and masked keys pass through `escapeHtml` as well.
// - Key state renders exactly the masked form it is given (`••••` + suffix);
//   the full key never reaches this module (AD-15).
import type { ProviderId } from '../core/provider';
import { currencySymbol, type NormalizedUsage } from '../core/usage';
import type { CycleSnapshot } from '../storage/snapshot-store';

/** Provider metadata the view needs; supplied from createDefaultRegistry (AD-6). */
export interface PopupProvider {
  readonly id: ProviderId;
  readonly displayName: string;
}

/** Everything a render needs — the controller assembles it from stores. */
export interface PopupState {
  readonly providers: readonly PopupProvider[];
  /** Last completed cycle; `undefined` = no cycle completed yet. */
  readonly snapshot: CycleSnapshot | undefined;
  /** Masked key form per provider (`KeyStore.readMaskedKey`); absent = no stored key. */
  readonly keyStates: Readonly<Partial<Record<ProviderId, string | undefined>>>;
  /** Last validation message per provider, rendered verbatim. */
  readonly guidance: Readonly<Partial<Record<ProviderId, string>>>;
}

/** Escapes the HTML-significant characters; defense-in-depth for fixture-sourced text. */
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

function providerSection(provider: PopupProvider, state: PopupState): string {
  const entry = state.snapshot?.results[provider.id];
  const masked = state.keyStates[provider.id];
  const guidance = state.guidance[provider.id];

  const parts: string[] = [`<section class="provider" data-provider="${provider.id}">`];
  parts.push(`<h2 class="provider-name">${escapeHtml(provider.displayName)}</h2>`);
  if (entry === undefined) {
    parts.push('<p class="no-cycle">No cycle data yet</p>');
  } else if (entry.status === 'error') {
    parts.push('<p class="refresh-error" role="status">Refresh failed</p>');
  } else {
    parts.push(`<p class="usage">${formatUsageText(entry.usage)}</p>`);
    if (entry.usage.tier !== undefined) {
      parts.push(`<p class="tier">Tier: ${escapeHtml(entry.usage.tier)}</p>`);
    }
  }
  if (masked !== undefined) {
    parts.push(`<p class="key-state">Stored key: ${escapeHtml(masked)}</p>`);
  }
  parts.push(
    `<form class="key-form" data-provider="${provider.id}">` +
      `<input type="password" autocomplete="off" id="key-input-${provider.id}" name="credential" placeholder="Credential" />` +
      `<button type="submit" id="key-add-${provider.id}">Save key</button>` +
      `<button type="button" class="revoke" id="key-revoke-${provider.id}" data-revoke="${provider.id}">Revoke</button>` +
      '</form>'
  );
  if (guidance !== undefined) {
    parts.push(`<p class="guidance" role="alert">${escapeHtml(guidance)}</p>`);
  }
  parts.push('</section>');
  return parts.join('');
}

/** Renders the whole popup as HTML; deterministic for identical state. */
export function renderPopup(state: PopupState): string {
  const sections = state.providers.map((provider) => providerSection(provider, state)).join('\n');
  return `<h1>quotadeck</h1>\n${sections}`;
}
