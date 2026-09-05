// Popup view tests (popup-ui spec §Provider List Rendering, §Masked Key
// Display) — node environment by design (AD-11): the view is a pure
// string-producing module, so determinism is plain strict string equality.
import { strictEqual } from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import type { ProviderId } from '../core/provider';
import { currencySymbol, type NormalizedUsage } from '../core/usage';
import type { CycleSnapshot } from '../storage/snapshot-store';
import { escapeHtml, formatUsageText, type PopupProvider, type PopupState, renderPopup } from './view';

/** Registry metadata as production supplies it (createDefaultRegistry, AD-6 order). */
const PROVIDERS: readonly PopupProvider[] = [
  { id: 'zai', displayName: 'ZAI (Zhipu AI)' },
  { id: 'qwen', displayName: 'Qwen (Alibaba Cloud BSS)' },
  { id: 'openai', displayName: 'OpenAI' },
  { id: 'kimi', displayName: 'Kimi (Moonshot AI)' },
];

function usage(providerId: ProviderId, overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return { providerId, kind: 'balance', value: 100, currency: 'CNY', fetchedAt: 1_754_000_000_000, ...overrides };
}

function popupState(overrides: Partial<PopupState> = {}): PopupState {
  return { providers: PROVIDERS, snapshot: undefined, keyStates: {}, guidance: {}, ...overrides };
}

/** Extracts one provider's <section> so assertions stay scoped per provider. */
function sectionFor(html: string, id: ProviderId): string {
  const start = html.indexOf(`data-provider="${id}"`);
  if (start === -1) {
    throw new Error(`no section rendered for ${id}`);
  }
  const end = html.indexOf('<section', start);
  return html.slice(start, end === -1 ? undefined : end);
}

describe('currencySymbol — core/usage export reused by popup display', () => {
  it('maps known ISO codes case-insensitively and falls back to empty for unknown ones', () => {
    expect(currencySymbol('CNY')).toBe('¥');
    expect(currencySymbol('usd')).toBe('$');
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('GBP')).toBe('£');
    expect(currencySymbol('XYZ')).toBe('');
  });
});

describe('formatUsageText', () => {
  it('renders currency symbol with a fixed two-decimal value', () => {
    expect(formatUsageText(usage('kimi', { value: 88.88, currency: 'CNY' }))).toBe('¥88.88');
    expect(formatUsageText(usage('openai', { kind: 'cost', value: 20, currency: 'usd' }))).toBe('$20.00');
  });

  it('falls back to the ISO code when no symbol is known', () => {
    expect(formatUsageText(usage('qwen', { value: 5.5, currency: 'XYZ' }))).toBe('XYZ5.50');
  });
});

describe('renderPopup — Provider List Rendering (popup-ui spec)', () => {
  const fullSnapshot: CycleSnapshot = {
    results: {
      zai: { status: 'ok', usage: usage('zai', { kind: 'cost', value: 39, tier: 'GLM-4.5-Air' }) },
      qwen: { status: 'error' },
      openai: { status: 'ok', usage: usage('openai', { kind: 'cost', value: 20, currency: 'usd' }) },
      kimi: { status: 'ok', usage: usage('kimi', { value: 88.88 }) },
    },
  };

  it('renders every provider with usage value and currency; tier only for the result including one', () => {
    const html = renderPopup(popupState({ snapshot: fullSnapshot }));

    for (const provider of PROVIDERS) {
      expect(html).toContain(`data-provider="${provider.id}"`);
      expect(html).toContain(provider.displayName);
    }
    expect(sectionFor(html, 'zai')).toContain('¥39.00');
    expect(sectionFor(html, 'zai')).toContain('Tier: GLM-4.5-Air');
    expect(sectionFor(html, 'openai')).toContain('$20.00');
    expect(sectionFor(html, 'kimi')).toContain('¥88.88');
    expect(sectionFor(html, 'openai')).not.toContain('Tier:');
    expect(sectionFor(html, 'kimi')).not.toContain('Tier:');
  });

  it('shows a per-provider error indication instead of usage for the failed provider', () => {
    const html = renderPopup(popupState({ snapshot: fullSnapshot }));

    expect(sectionFor(html, 'qwen')).toContain('Refresh failed');
    expect(sectionFor(html, 'qwen')).not.toContain('¥');
    expect(sectionFor(html, 'kimi')).not.toContain('Refresh failed');
  });

  it('renders a no-cycle note for providers absent from the snapshot (no key at cycle time)', () => {
    const partial: CycleSnapshot = { results: { zai: fullSnapshot.results.zai! } };
    const html = renderPopup(popupState({ snapshot: partial }));

    expect(sectionFor(html, 'zai')).toContain('¥39.00');
    expect(sectionFor(html, 'qwen')).toContain('No cycle data yet');
    expect(sectionFor(html, 'kimi')).toContain('No cycle data yet');
  });

  it('renders an empty state per provider when no snapshot exists (no cycle completed yet)', () => {
    const html = renderPopup(popupState({ snapshot: undefined }));

    for (const provider of PROVIDERS) {
      expect(sectionFor(html, provider.id)).toContain('No cycle data yet');
    }
  });

  it('is deterministic: identical state renders identical output', () => {
    const state = popupState({
      snapshot: fullSnapshot,
      keyStates: { kimi: '••••cdef' },
      guidance: { qwen: 'Use an Alibaba AK/SK pair.' },
    });

    strictEqual(renderPopup(state), renderPopup(state));
  });

  it('renders stored keys in their masked form and nothing when absent', () => {
    const html = renderPopup(popupState({ keyStates: { openai: '••••1234' } }));

    expect(sectionFor(html, 'openai')).toContain('••••1234');
    expect(sectionFor(html, 'kimi')).not.toContain('••••1234');
  });

  it('renders validation guidance only for the provider that has one', () => {
    const message = 'Use an Alibaba AK/SK pair.';
    const html = renderPopup(popupState({ guidance: { qwen: message } }));

    expect(sectionFor(html, 'qwen')).toContain(message);
    expect(sectionFor(html, 'kimi')).not.toContain(message);
  });
});

describe('escapeHtml', () => {
  it('escapes the HTML-significant characters', () => {
    expect(escapeHtml('<img src=x>&"\'`')).toBe('&lt;img src=x&gt;&amp;&quot;&#39;&#96;');
  });

  it('escapes fixture-sourced tier values in rendered output', () => {
    const hostile = '<script>alert(1)</script>';
    const snapshot: CycleSnapshot = {
      results: { zai: { status: 'ok', usage: usage('zai', { tier: hostile }) } },
    };
    const html = renderPopup(popupState({ snapshot }));

    expect(html).not.toContain(hostile);
    expect(html).toContain('&lt;script&gt;');
  });
});
