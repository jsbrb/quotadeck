// Popup view tests (popup-ui spec §Settings Gear Surface, §Per-Model
// Consumption View; AD-22) — node environment by design (AD-11): the view is
// a pure string-producing module, so determinism is plain strict string
// equality.
import { strictEqual } from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import type { ProviderId } from '../core/provider';
import type { ErrorClass } from '../refresh/error-taxonomy';
import { currencySymbol, type NormalizedUsage } from '../core/usage';
import type { CycleSnapshot } from '../storage/snapshot-store';
import {
  escapeHtml,
  formatResetCountdown,
  formatUsageText,
  type PopupProvider,
  type PopupState,
  renderMain,
  renderSettings,
} from './view';

/** Registry metadata as production supplies it (PROVIDER_METADATA, AD-6/24 order). */
const PROVIDERS: readonly PopupProvider[] = [
  { id: 'zai', displayName: 'ZAI (Zhipu AI)', credentialType: 'bearer' },
  { id: 'qwen', displayName: 'Qwen (Alibaba Cloud BSS)', credentialType: 'ak-sk' },
  { id: 'openai', displayName: 'OpenAI', credentialType: 'openai-admin-read' },
  { id: 'kimi', displayName: 'Kimi (Moonshot AI)', credentialType: 'bearer' },
];

const NOW_MS = 1_754_000_000_000;

function usage(providerId: ProviderId, overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return { providerId, kind: 'balance', value: 100, currency: 'CNY', fetchedAt: NOW_MS, ...overrides };
}

function popupState(overrides: Partial<PopupState> = {}): PopupState {
  return {
    view: 'main',
    providers: PROVIDERS,
    snapshot: undefined,
    keyStates: {},
    guidance: {},
    nowMs: NOW_MS,
    ...overrides,
  };
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

describe('formatResetCountdown — pure reset countdown (AD-22)', () => {
  it('formats hours and ceiling minutes: 2h, 90m, 45m', () => {
    expect(formatResetCountdown(NOW_MS + 2 * 3_600_000, NOW_MS)).toBe('2h 0m');
    expect(formatResetCountdown(NOW_MS + 90 * 60_000, NOW_MS)).toBe('1h 30m');
    expect(formatResetCountdown(NOW_MS + 45 * 60_000, NOW_MS)).toBe('45m');
  });

  it('rounds partial minutes up and collapses elapsed resets to 0m', () => {
    expect(formatResetCountdown(NOW_MS + 59.5 * 60_000, NOW_MS)).toBe('1h 0m'); // ceil(59.5) = 60
    expect(formatResetCountdown(NOW_MS, NOW_MS)).toBe('0m');
    expect(formatResetCountdown(NOW_MS - 60_000, NOW_MS)).toBe('0m');
  });
});

describe('renderMain — Settings Gear Surface (popup-ui spec)', () => {
  it('renders the settings gear in the header and NO key forms or inputs in the main view', () => {
    const html = renderMain(popupState());

    expect(html).toContain('data-action="open-settings"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
  });

  it('keeps masked key material out of the main view — key state renders in settings only', () => {
    const state = popupState({ keyStates: { kimi: { type: 'bearer', maskedToken: '••••cdef' } } });
    const html = renderMain(state);

    expect(html).not.toContain('••••');
    expect(renderSettings({ ...state, view: 'settings' })).toContain('••••cdef');
  });
});

describe('renderMain — Per-Model Consumption View (popup-ui spec)', () => {
  const fullSnapshot: CycleSnapshot = {
    results: {
      zai: {
        status: 'ok',
        usage: usage('zai', {
          kind: 'cost',
          value: 39,
          tier: 'Lite',
          budget: { used: 2400, limit: 2400, percent: 100, tier: 'Lite', resetAt: NOW_MS + 90 * 60_000 },
        }),
      },
      openai: {
        status: 'ok',
        usage: usage('openai', {
          kind: 'cost',
          value: 20,
          currency: 'usd',
          breakdown: [
            { model: 'gpt-5.3', usageType: 'output_tokens', value: 4.25 },
            { model: 'gpt-5-mini', usageType: 'input_tokens', value: 3.25 },
            { model: 'gpt-5.3', usageType: 'input_tokens', value: 12.5 },
          ],
        }),
      },
      kimi: { status: 'ok', usage: usage('kimi', { value: 88.88 }) },
    },
  };

  it('renders every provider with its usage value and currency; tier only for the result including one', () => {
    const html = renderMain(popupState({ snapshot: fullSnapshot }));

    for (const provider of PROVIDERS) {
      expect(html).toContain(`data-provider="${provider.id}"`);
      expect(html).toContain(provider.displayName);
    }
    expect(sectionFor(html, 'zai')).toContain('¥39.00');
    expect(sectionFor(html, 'zai')).toContain('Tier: Lite');
    expect(sectionFor(html, 'openai')).toContain('$20.00');
    expect(sectionFor(html, 'kimi')).toContain('¥88.88');
    expect(sectionFor(html, 'kimi')).not.toContain('Tier:');
  });

  it('renders the ZAI budget block: percent, used/limit, tier and countdown', () => {
    const html = renderMain(popupState({ snapshot: fullSnapshot }));
    const zai = sectionFor(html, 'zai');

    expect(zai).toContain('Budget: 100% of 2400 (2400 used)');
    expect(zai).toContain('Resets in 1h 30m');
    expect(zai).toContain('Tier: Lite');
  });

  it('omits the countdown when resetAt is absent and degrades the summary when the tier has no limit', () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: usage('zai', {
            kind: 'cost',
            value: 0.5,
            budget: { used: 700, limit: undefined, percent: undefined, tier: undefined, resetAt: undefined },
          }),
        },
      },
    };
    const zai = sectionFor(renderMain(popupState({ snapshot })), 'zai');

    expect(zai).toContain('Budget: 700 used');
    expect(zai).not.toContain('Resets in');
    expect(zai).not.toContain('Tier:');
  });

  it('renders per-model rows for the provider with a breakdown, sorted by model then usageType', () => {
    const html = renderMain(popupState({ snapshot: fullSnapshot }));
    const openai = sectionFor(html, 'openai');

    // Plain ASCII order: 'gpt-5-' sorts before 'gpt-5.' (hyphen < dot), and
    // within one model input_tokens sorts before output_tokens.
    const first = openai.indexOf('gpt-5-mini · input_tokens');
    const second = openai.indexOf('gpt-5.3 · input_tokens');
    const third = openai.indexOf('gpt-5.3 · output_tokens');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second); // same model: input_tokens before output_tokens
    expect(openai).toContain('$12.50');
    expect(sectionFor(html, 'kimi')).not.toContain('model-row'); // no breakdown → no rows
  });

  it('renders a distinct label per error class (AD-21/22)', () => {
    const labels: Readonly<Record<ErrorClass, string>> = {
      auth: 'Auth failed',
      'rate-limit': 'Rate limited',
      server: 'Server error',
      network: 'Network error',
      unknown: 'Refresh failed',
    };
    for (const [errorClass, label] of Object.entries(labels) as Array<[ErrorClass, string]>) {
      const html = renderMain(popupState({ snapshot: { results: { kimi: { status: 'error', errorClass } } } }));
      expect(sectionFor(html, 'kimi')).toContain(label);
    }
  });

  it('renders a no-cycle note for providers absent from the snapshot', () => {
    const html = renderMain(popupState({ snapshot: { results: { kimi: fullSnapshot.results.kimi! } } }));

    expect(sectionFor(html, 'kimi')).toContain('¥88.88');
    expect(sectionFor(html, 'zai')).toContain('No cycle data yet');
    expect(sectionFor(html, 'qwen')).toContain('No cycle data yet');
  });

  it('is deterministic: identical state renders identical output in both views', () => {
    const state = popupState({
      snapshot: fullSnapshot,
      keyStates: { kimi: { type: 'bearer', maskedToken: '••••cdef' } },
      guidance: { qwen: 'Use an Alibaba AK/SK pair.' },
    });

    strictEqual(renderMain(state), renderMain(state));
    strictEqual(renderSettings({ ...state, view: 'settings' }), renderSettings({ ...state, view: 'settings' }));
  });
});

describe('renderSettings — key management inside the gear (popup-ui spec)', () => {
  it('renders the back switch in the header and one form per provider', () => {
    const html = renderSettings(popupState({ view: 'settings' }));

    expect(html).toContain('data-action="back"');
    expect(html).not.toContain('data-action="open-settings"');
    for (const provider of PROVIDERS) {
      expect(sectionFor(html, provider.id)).toContain(`id="key-add-${provider.id}"`);
      expect(sectionFor(html, provider.id)).toContain(`data-revoke="${provider.id}"`);
    }
  });

  it('renders TWO password fields for the qwen AK/SK pair and one for token providers (AD-17)', () => {
    const html = renderSettings(popupState({ view: 'settings' }));

    const qwen = sectionFor(html, 'qwen');
    expect(qwen).toContain('id="key-input-qwen-ak"');
    expect(qwen).toContain('id="key-input-qwen-sk"');
    expect(qwen).not.toContain('id="key-input-qwen"'); // no single legacy field
    expect(sectionFor(html, 'openai')).toContain('id="key-input-openai"');
    expect(sectionFor(html, 'openai')).not.toContain('-ak"');
  });

  it('renders masked key states per provider — both pair parts for qwen, one for tokens', () => {
    const html = renderSettings(
      popupState({
        view: 'settings',
        keyStates: {
          qwen: { type: 'ak-sk', maskedAccessKeyId: '••••AK00', maskedAccessKeySecret: '••••0000' },
          openai: { type: 'openai-admin-read', maskedToken: '••••1234' },
        },
      }),
    );

    expect(sectionFor(html, 'qwen')).toContain('AccessKeyId: ••••AK00');
    expect(sectionFor(html, 'qwen')).toContain('AccessKeySecret: ••••0000');
    expect(sectionFor(html, 'openai')).toContain('Stored key: ••••1234');
    expect(sectionFor(html, 'kimi')).not.toContain('••••');
  });

  it('renders validation guidance only for the provider that has one', () => {
    const message = 'Use an Alibaba AK/SK pair.';
    const html = renderSettings(popupState({ view: 'settings', guidance: { qwen: message } }));

    expect(sectionFor(html, 'qwen')).toContain(message);
    expect(sectionFor(html, 'kimi')).not.toContain(message);
  });
});

describe('escapeHtml', () => {
  it('escapes the HTML-significant characters', () => {
    expect(escapeHtml('<img src=x>&"\'`')).toBe('&lt;img src=x&gt;&amp;&quot;&#39;&#96;');
  });

  it('escapes provider-sourced model names in rendered output', () => {
    const hostile = '<script>alert(1)</script>';
    const snapshot: CycleSnapshot = {
      results: {
        openai: {
          status: 'ok',
          usage: usage('openai', { kind: 'cost', value: 1, currency: 'usd', breakdown: [{ model: hostile, usageType: 'input', value: 1 }] }),
        },
      },
    };
    const html = renderMain(popupState({ snapshot }));

    expect(html).not.toContain(hostile);
    expect(html).toContain('&lt;script&gt;');
  });
});
