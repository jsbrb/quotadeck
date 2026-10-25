// Popup view tests (popup-ui spec §Settings Gear Surface, §Per-Model
// Consumption View, §ZAI Platform Selector; AD-22/26/27/28) — node
// environment by design (AD-11): the view is a pure string-producing module,
// so determinism is plain strict string equality.
import { strictEqual } from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import type { ProviderId } from '../core/provider';
import type { ErrorClass } from '../refresh/error-taxonomy';
import { currencySymbol, type McpWindow, type MonitorWindows, type NormalizedUsage, type PlanInfo } from '../core/usage';
import type { MaskedCredential } from '../storage/key-store';
import type { CycleSnapshot } from '../storage/snapshot-store';
import {
  escapeHtml,
  formatResetCountdown,
  formatUsageText,
  type PopupProvider,
  type PopupState,
  renderMain,
  renderSettings,
  SETTINGS_GUIDANCE,
  thresholdBand,
  ZAI_WRONG_PLATFORM_GUIDANCE,
} from './view';

/** Registry metadata as production supplies it (PROVIDER_METADATA, AD-6/24 order). */
const PROVIDERS: readonly PopupProvider[] = [
  { id: 'zai', displayName: 'ZAI (Zhipu AI)', credentialType: 'raw' },
  { id: 'qwen', displayName: 'Qwen (Alibaba Cloud BSS)', credentialType: 'ak-sk' },
  { id: 'openai', displayName: 'OpenAI', credentialType: 'openai-admin-read' },
  { id: 'kimi', displayName: 'Kimi (Moonshot AI)', credentialType: 'bearer' },
];

const NOW_MS = 1_754_000_000_000;

/**
 * Every provider keyed (hito-6 §Provider List Rendering): the main view
 * renders cards only for providers with a stored credential, so the shared
 * popupState factory seeds a masked credential per provider; keyless tests
 * override individual entries with `undefined`.
 */
const KEYED_STATES: Readonly<Record<ProviderId, MaskedCredential>> = {
  zai: { type: 'raw', maskedToken: '••••zai1' },
  qwen: { type: 'ak-sk', maskedAccessKeyId: '••••AK00', maskedAccessKeySecret: '••••0000' },
  openai: { type: 'openai-admin-read', maskedToken: '••••1234' },
  kimi: { type: 'bearer', maskedToken: '••••cdef' },
};

/** Full monitor payload (AD-26/27): level, both windows, MCP with two tools. */
const MONITOR_WINDOWS: MonitorWindows = {
  level: 'Pro',
  fiveHour: { percentage: 137, used: 16_440, total: 12_000, resetAt: NOW_MS + 90 * 60_000 },
  weekly: { percentage: 42, used: 5_040, total: 12_000 },
  mcp: { used: 3, ceiling: 60, tools: [{ name: 'web-search', used: 2 }, { name: 'code-execution', used: 1 }] },
};

/** Last cycle with all four providers ok — the spec's full-render scenario. */
const FULL_SNAPSHOT: CycleSnapshot = {
  results: {
    zai: {
      status: 'ok',
      usage: { providerId: 'zai', kind: 'cost', windows: MONITOR_WINDOWS, fetchedAt: NOW_MS },
    },
    qwen: { status: 'ok', usage: usage('qwen', { value: 100.28, tier: 'L2' }) },
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

function usage(providerId: ProviderId, overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return { providerId, kind: 'balance', value: 100, currency: 'CNY', fetchedAt: NOW_MS, ...overrides };
}

function popupState(overrides: Partial<PopupState> = {}): PopupState {
  return {
    view: 'main',
    providers: PROVIDERS,
    snapshot: undefined,
    keyStates: KEYED_STATES,
    guidance: {},
    nowMs: NOW_MS,
    zaiPlatform: 'zai',
    qwenSite: 'international',
    badgeProvider: 'zai',
    qwenPlanKey: undefined,
    ...overrides,
  };
}

/** A last cycle whose qwen entry carries plan status (hito-8 §Qwen Plan Line). */
function qwenPlanSnapshot(plan: PlanInfo, overrides: Partial<NormalizedUsage> = {}): CycleSnapshot {
  return { results: { qwen: { status: 'ok', usage: usage('qwen', { value: 100.28, plan, ...overrides }) } } };
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

/** Strips tags so combined-text assertions survive nested elements (countdown span, bar divs). */
const stripTags = (html: string): string => html.replace(/<[^>]*>/g, '');

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

  it('renders an empty string for a monitor result without a monetary value (AD-26)', () => {
    const monitor = usage('zai', {
      kind: 'cost',
      value: undefined,
      currency: undefined,
      windows: MONITOR_WINDOWS,
    });
    expect(formatUsageText(monitor)).toBe('');
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
  it('renders the settings gear in the header and NO key forms, inputs or selects in the main view', () => {
    const html = renderMain(popupState());

    expect(html).toContain('data-action="open-settings"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<select'); // the platform selector lives in settings only
  });

  it('keeps masked key material out of the main view — key state renders in settings only', () => {
    const state = popupState({ keyStates: { kimi: { type: 'bearer', maskedToken: '••••cdef' } } });
    const html = renderMain(state);

    expect(html).not.toContain('••••');
    expect(renderSettings({ ...state, view: 'settings' })).toContain('••••cdef');
  });
});

describe('renderMain — Per-Model Consumption View (popup-ui spec)', () => {
  const fullSnapshot = FULL_SNAPSHOT;

  it('renders every provider; monetary providers with value and currency; tier only for the result including one', () => {
    const html = renderMain(popupState({ snapshot: fullSnapshot }));

    for (const provider of PROVIDERS) {
      expect(html).toContain(`data-provider="${provider.id}"`);
      expect(html).toContain(provider.displayName);
    }
    expect(sectionFor(html, 'zai')).not.toContain('¥'); // monitor result: no monetary line
    expect(sectionFor(html, 'qwen')).toContain('¥100.28');
    expect(sectionFor(html, 'qwen')).toContain('Tier: L2');
    expect(sectionFor(html, 'openai')).toContain('$20.00');
    expect(sectionFor(html, 'kimi')).toContain('¥88.88');
    expect(sectionFor(html, 'kimi')).not.toContain('Tier:');
  });

  it('renders the ZAI monitor block: level, uncapped 5h with used/total/countdown, weekly, MCP rows', () => {
    const html = renderMain(popupState({ snapshot: fullSnapshot }));
    const zai = sectionFor(html, 'zai');

    expect(zai).toContain('Level: Pro');
    // combined textContent (the countdown span splits the raw string); the 5h
    // percentage lives in the hero + bar-pct now (hito-6) — the line keeps
    // label, used/total and countdown.
    expect(stripTags(zai)).toContain('5h: 16440 / 12000 · Resets in 1h 30m');
    expect(zai).toContain('<p class="hero-percentage">137%</p>'); // 137 stays 137 — uncapped
    expect(stripTags(zai)).toContain('Weekly: 42% · 5040 / 12000');
    expect(zai).toContain('MCP: 3 / 60');
    // Per-tool rows sorted by name for determinism (AD-27 ordering, view-side too).
    const codeExecution = zai.indexOf('code-execution · 1');
    const webSearch = zai.indexOf('web-search · 2');
    expect(codeExecution).toBeGreaterThan(-1);
    expect(webSearch).toBeGreaterThan(codeExecution);
  });

  it('omits absent windows, window parts and the countdown — nothing synthesized (AD-26/27)', () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: usage('zai', {
            kind: 'cost',
            value: undefined,
            currency: undefined,
            windows: {
              fiveHour: { used: 700, total: 12_000 },
              mcp: { used: 1, ceiling: 5, tools: [] },
            },
          }),
        },
      },
    };
    const zai = sectionFor(renderMain(popupState({ snapshot })), 'zai');

    expect(zai).toContain('5h: 700 / 12000'); // no percentage part when the API omitted it
    expect(stripTags(zai)).not.toContain('%'); // no synthesized percentage text (bar widths are attributes)
    expect(zai).not.toContain('Resets in'); // resetAt absent → no countdown line
    expect(zai).not.toContain('Weekly:'); // absent window not rendered
    expect(zai).not.toContain('Level:'); // level absent → line omitted
    expect(zai).toContain('MCP: 1 / 5');
    expect(zai).not.toContain('mcp-tool'); // empty tools list → no rows
  });

  it('renders a window whose used is absent as the bare total; rounds fractional percentages for display', () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: usage('zai', {
            kind: 'cost',
            value: undefined,
            currency: undefined,
            windows: {
              fiveHour: { percentage: 42.6, total: 12_000 },
              weekly: { total: 130_000 },
            },
          }),
        },
      },
    };
    const zai = sectionFor(renderMain(popupState({ snapshot })), 'zai');

    expect(zai).toContain('5h: 12000 total'); // no used part; the pct lives in hero + bar (hito-6)
    expect(zai).toContain('<p class="hero-percentage">43%</p>'); // Math.round(42.6) for display
    expect(zai).toContain('Weekly: 130000 total');
  });

  it('renders a total-less window (live plan-pro shape) as percentage + countdown only', () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: usage('zai', {
            kind: 'cost',
            value: undefined,
            currency: undefined,
            windows: { level: 'pro', fiveHour: { percentage: 32, resetAt: NOW_MS + 90 * 60_000 } },
          }),
        },
      },
    };
    const zai = sectionFor(renderMain(popupState({ snapshot })), 'zai');

    expect(zai).toContain('Level: pro');
    expect(zai).toContain('<p class="hero-percentage">32%</p>'); // pct-only window: hero + bar, no line parts
    expect(stripTags(zai)).toContain('Resets in 1h 30m'); // countdown stays in the line's combined text
    expect(zai).not.toContain('undefined'); // the absent total must not leak into text
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

  it('surfaces the wrong-platform guidance on a ZAI auth failure (AD-27; popup-ui spec)', () => {
    const html = renderMain(popupState({ snapshot: { results: { zai: { status: 'error', errorClass: 'auth' } } } }));
    const zai = sectionFor(html, 'zai');

    expect(zai).toContain('Auth failed'); // the per-class label stays
    expect(zai).toContain(ZAI_WRONG_PLATFORM_GUIDANCE); // …plus the static guidance
  });

  it('keeps the guidance zai+auth specific — other classes, providers and ok results render none', () => {
    const rateLimit = renderMain(popupState({ snapshot: { results: { zai: { status: 'error', errorClass: 'rate-limit' } } } }));
    expect(sectionFor(rateLimit, 'zai')).not.toContain(ZAI_WRONG_PLATFORM_GUIDANCE);

    const kimiAuth = renderMain(popupState({ snapshot: { results: { kimi: { status: 'error', errorClass: 'auth' } } } }));
    expect(sectionFor(kimiAuth, 'kimi')).not.toContain(ZAI_WRONG_PLATFORM_GUIDANCE);

    const ok = renderMain(popupState({ snapshot: fullSnapshot }));
    expect(sectionFor(ok, 'zai')).not.toContain(ZAI_WRONG_PLATFORM_GUIDANCE);
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
      zaiPlatform: 'zhipu',
      keyStates: { kimi: { type: 'bearer', maskedToken: '••••cdef' } },
      guidance: { qwen: 'Use an Alibaba AK/SK pair.' },
    });

    strictEqual(renderMain(state), renderMain(state));
    strictEqual(renderSettings({ ...state, view: 'settings' }), renderSettings({ ...state, view: 'settings' }));
  });

  it('renders bars and guidance deterministically — repeated renders stay byte-identical', () => {
    const state = popupState({
      snapshot: fullSnapshot, // bars via the monitor windows (zai keyed by default)
      guidance: { kimi: 'Credential must not be empty.' },
    });
    const mainA = renderMain(state);
    const settingsA = renderSettings({ ...state, view: 'settings' });

    strictEqual(mainA, renderMain(state));
    strictEqual(settingsA, renderSettings({ ...state, view: 'settings' }));
    expect(mainA).toContain('class="bar '); // the compared output actually carries bars…
    expect(settingsA).toContain('Credential must not be empty.'); // …and guidance
  });

  it('renders plan-carrying state deterministically — repeated renders stay byte-identical (verify W1 gap, hito-8)', () => {
    const state = popupState({
      snapshot: qwenPlanSnapshot({ status: 'exhausted', resetAt: NOW_MS + 2 * 3_600_000 }),
      qwenPlanKey: { type: 'qwen-plan', maskedToken: '••••cdef' },
      keyStates: KEYED_STATES,
    });
    const mainA = renderMain(state);
    const settingsA = renderSettings({ ...state, view: 'settings' });

    strictEqual(mainA, renderMain(state));
    strictEqual(settingsA, renderSettings({ ...state, view: 'settings' }));
    expect(mainA).toContain('Plan: exhausted'); // the compared output actually carries the plan line
    expect(settingsA).toContain('id="key-input-qwen-plan"'); // …and the plan-key group
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

describe('renderSettings — ZAI Platform Selector (popup-ui spec §ZAI Platform Selector; AD-28)', () => {
  it('renders the selector in the ZAI section only, with unmasked Z.AI/ZHIPU labels', () => {
    const html = renderSettings(popupState({ view: 'settings' }));
    const zai = sectionFor(html, 'zai');

    expect(zai).toContain('id="zai-platform-select"');
    expect(zai).toContain('>Z.AI</option>');
    expect(zai).toContain('>ZHIPU</option>');
    expect(sectionFor(html, 'kimi')).not.toContain('zai-platform-select'); // zai only
  });

  it('marks the current platform selected — Z.AI by default, ZHIPU when the preference says so', () => {
    const byDefault = sectionFor(renderSettings(popupState({ view: 'settings' })), 'zai');
    expect(byDefault).toContain('<option value="zai" selected>');
    expect(byDefault).not.toContain('<option value="zhipu" selected>');

    const zhipu = sectionFor(renderSettings(popupState({ view: 'settings', zaiPlatform: 'zhipu' })), 'zai');
    expect(zhipu).toContain('<option value="zhipu" selected>');
    expect(zhipu).not.toContain('<option value="zai" selected>');
  });
});

describe('renderSettings — Qwen Site Selector (popup-ui spec §Qwen Site Selector)', () => {
  it('renders the selector in the qwen section only, with unmasked labels that mark international as the default', () => {
    const html = renderSettings(popupState({ view: 'settings' }));
    const qwen = sectionFor(html, 'qwen');

    expect(qwen).toContain('id="qwen-site-select"');
    expect(qwen).toContain('>International (default)</option>');
    expect(qwen).toContain('>China</option>');
    expect(sectionFor(html, 'kimi')).not.toContain('qwen-site-select'); // qwen only
  });

  it('marks the current site selected — International by default, China when the preference says so', () => {
    const byDefault = sectionFor(renderSettings(popupState({ view: 'settings' })), 'qwen');
    expect(byDefault).toContain('<option value="international" selected>');
    expect(byDefault).not.toContain('<option value="china" selected>');

    const china = sectionFor(renderSettings(popupState({ view: 'settings', qwenSite: 'china' })), 'qwen');
    expect(china).toContain('<option value="china" selected>');
    expect(china).not.toContain('<option value="international" selected>');
  });
});

describe('renderSettings — Badge Provider Selector (popup-ui spec §Badge Provider Selector; hito-12 WU-D2)', () => {
  it('renders exactly one top-level selector with unmasked displayName options from the provider list', () => {
    const html = renderSettings(popupState({ view: 'settings' }));

    expect(html.match(/id="badge-provider-select"/g)).toHaveLength(1); // once, not per section
    expect(html).toContain('<label for="badge-provider-select">Badge provider</label>');
    expect(html).toContain('<option value="zai" selected>ZAI (Zhipu AI)</option>'); // default choice carries selected
    expect(html).toContain('<option value="qwen">Qwen (Alibaba Cloud BSS)</option>');
    // options come from state.providers — data-driven, never hardcoded:
    expect(html).toContain('<option value="openai">OpenAI</option>');
    expect(html).toContain('<option value="kimi">Kimi (Moonshot AI)</option>');
  });

  it('marks the stored choice selected, not the default', () => {
    const html = renderSettings(popupState({ view: 'settings', badgeProvider: 'qwen' }));
    // Scoped to the badge select itself: the ZAI platform selector renders
    // its own `<option value="zai" selected>` and must not confuse the pin.
    const start = html.indexOf('id="badge-provider-select"');
    const select = html.slice(start, html.indexOf('</select>', start));

    expect(select).toContain('<option value="qwen" selected>');
    expect(select).not.toContain('<option value="zai" selected>');
  });
});

describe('renderMain — Qwen Plan Line (popup-ui spec §Qwen Plan Line, hito-8)', () => {
  it('renders the plan line per status: Available / exhausted · countdown / key rejected', () => {
    const available = sectionFor(renderMain(popupState({ snapshot: qwenPlanSnapshot({ status: 'available' }) })), 'qwen');
    expect(available).toContain('Plan: Available');

    const exhausted = sectionFor(
      renderMain(popupState({ snapshot: qwenPlanSnapshot({ status: 'exhausted', resetAt: NOW_MS + 2 * 3_600_000 }) })),
      'qwen',
    );
    expect(stripTags(exhausted)).toContain('Plan: exhausted · resets in 2h 0m'); // combined textContent (countdown span)

    const rejected = sectionFor(renderMain(popupState({ snapshot: qwenPlanSnapshot({ status: 'key-rejected' }) })), 'qwen');
    expect(rejected).toContain('Plan: key rejected');
  });

  it('an exhausted status without a reset instant renders no countdown — nothing is synthesized', () => {
    const qwen = sectionFor(renderMain(popupState({ snapshot: qwenPlanSnapshot({ status: 'exhausted' }) })), 'qwen');

    expect(qwen).toContain('Plan: exhausted');
    expect(qwen).not.toContain('resets in');
  });

  it('the plan line sits below the balance, which stays the leading figure; no hero is synthesized', () => {
    const qwen = sectionFor(
      renderMain(popupState({ snapshot: qwenPlanSnapshot({ status: 'exhausted', resetAt: NOW_MS + 90 * 60_000 }) })),
      'qwen',
    );

    expect(qwen.indexOf('¥100.28')).toBeGreaterThan(-1);
    expect(qwen.indexOf('Plan:')).toBeGreaterThan(qwen.indexOf('¥100.28')); // below the balance
    expect(qwen).not.toContain('hero-percentage'); // monetary card: no hero, plan is not a percentage
  });

  it('renders no plan line when the cycle result carries no plan status', () => {
    const qwen = sectionFor(renderMain(popupState({ snapshot: { results: { qwen: { status: 'ok', usage: usage('qwen') } } } })), 'qwen');

    expect(qwen).not.toContain('Plan:');
  });

  it('a plan-only card renders: plan key stored, no pair, value-less ok entry', () => {
    const snapshot: CycleSnapshot = {
      results: { qwen: { status: 'ok', usage: usage('qwen', { value: undefined, currency: undefined, plan: { status: 'available' } }) } },
    };
    const html = renderMain(
      popupState({ snapshot, keyStates: { ...KEYED_STATES, qwen: undefined }, qwenPlanKey: { type: 'qwen-plan', maskedToken: '••••cdef' } }),
    );
    const qwen = sectionFor(html, 'qwen');

    expect(qwen).toContain('Plan: Available'); // the plan line renders…
    expect(qwen).not.toContain('No cycle data yet'); // …from a real cycle entry…
    expect(qwen).not.toContain('¥'); // …with no balance figure (empty usage line, like monitor cards)
    expect(qwen).not.toContain('•••'); // masked key material stays out of the main view
  });

  it('a keyless-pair qwen with a plan key still renders its card (either credential keys the card)', () => {
    const html = renderMain(
      popupState({ keyStates: { ...KEYED_STATES, qwen: undefined }, qwenPlanKey: { type: 'qwen-plan', maskedToken: '••••cdef' } }),
    );

    expect(html).toContain('data-provider="qwen"'); // plan key alone keys the card
    expect(sectionFor(html, 'qwen')).toContain('No cycle data yet'); // no cycle yet — honest note
  });
});

describe('renderSettings — Qwen Plan Key Settings Group (popup-ui spec, hito-8)', () => {
  it('renders the second field group with its own input, save and revoke controls in the qwen section only', () => {
    const html = renderSettings(popupState({ view: 'settings' }));
    const qwen = sectionFor(html, 'qwen');

    expect(qwen).toContain('Plan key (sk-sp-)');
    expect(qwen).toContain('id="key-input-qwen-plan"');
    expect(qwen).toContain('id="key-add-qwen-plan"');
    expect(qwen).toContain('data-revoke="qwen-plan"');
    expect(sectionFor(html, 'kimi')).not.toContain('qwen-plan'); // qwen section only
  });

  it('renders the stored plan key masked with at most 4 trailing characters', () => {
    const qwen = sectionFor(
      renderSettings(popupState({ view: 'settings', qwenPlanKey: { type: 'qwen-plan', maskedToken: '••••cdef' } })),
      'qwen',
    );

    expect(qwen).toContain('Plan key: ••••cdef');
    expect(qwen).not.toContain('sk-sp-full-key-material');
  });

  it('renders the plan-slot validation guidance inside the qwen section, separate from the static copy', () => {
    const message = 'The Qwen plan key is a separate inference-only sk-sp- key.';
    const qwen = sectionFor(renderSettings(popupState({ view: 'settings', guidance: { 'qwen-plan': message } })), 'qwen');

    expect(qwen).toContain(`<p class="guidance" role="alert">${message}</p>`);
    expect(qwen.indexOf(message)).toBeGreaterThan(qwen.indexOf('Plan key (sk-sp-)')); // near its group
  });

  it('updated qwen guidance copy covers balance, plan and site (popup-ui §Settings Guidance MODIFIED)', () => {
    const qwen = SETTINGS_GUIDANCE.qwen;
    // Balance (preserved elements).
    expect(qwen).toContain('Access Key ID');
    expect(qwen).toContain('Access Key Secret');
    expect(qwen).toContain('bss:DescribeAcccount');
    expect(qwen).toContain('DashScope sk- keys do not work');
    // Plan (new): inference-only sk-sp-, intl endpoint, 1-token cost, NOT the pair.
    expect(qwen).toContain('sk-sp-');
    expect(qwen).toContain('inference-only');
    expect(qwen).toContain('1-token');
    expect(qwen).toContain('NOT the AccessKey pair');
    // Site: intl default on ap-southeast-1, china selects China.
    expect(qwen).toContain('ap-southeast-1');
    expect(qwen).toContain('China');
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

  it('escapes provider-sourced level and tool names in the monitor block', () => {
    const hostile = '<script>alert(1)</script>';
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: usage('zai', {
            kind: 'cost',
            value: undefined,
            currency: undefined,
            windows: {
              level: hostile,
              mcp: { used: 1, ceiling: 5, tools: [{ name: hostile, used: 1 }] },
            },
          }),
        },
      },
    };
    const html = renderMain(popupState({ snapshot }));

    expect(html).not.toContain(`>${hostile}<`);
    expect((html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('thresholdBand — contiguous bands from the rounded displayed percentage', () => {
  it('maps 55 to green, 70 to amber, 90 to red and 137 to red (popup-ui §Threshold bands)', () => {
    expect(thresholdBand(55)).toBe('band-green');
    expect(thresholdBand(70)).toBe('band-amber');
    expect(thresholdBand(90)).toBe('band-red');
    expect(thresholdBand(137)).toBe('band-red'); // no percentage unmapped
  });

  it('bands follow the ROUNDED displayed percentage — band and text can never disagree at .5 boundaries', () => {
    expect(thresholdBand(69.4)).toBe('band-green'); // displays as 69%
    expect(thresholdBand(69.5)).toBe('band-amber'); // displays as 70%
    expect(thresholdBand(89.4)).toBe('band-amber'); // displays as 89%
    expect(thresholdBand(89.5)).toBe('band-red'); // displays as 90%
  });
});

describe('renderMain — Threshold bands + capped fill (popup-ui spec)', () => {
  /** Renders the ZAI section for a 5h window carrying only a percentage. */
  function renderFiveHour(percentage: number): string {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: usage('zai', {
            kind: 'cost',
            value: undefined,
            currency: undefined,
            windows: { fiveHour: { percentage } },
          }),
        },
      },
    };
    return sectionFor(renderMain(popupState({ snapshot })), 'zai');
  }

  it('renders a threshold-colored bar after each percentage-bearing window line', () => {
    // The 5h bar is the primary bar: it carries the same percentage as a
    // bar-pct overlay (hito-6 — the figure renders twice: hero + in-bar).
    expect(renderFiveHour(55)).toContain(
      '<div class="bar band-green"><div class="bar-fill" style="width: 55%"></div><span class="bar-pct">55%</span></div>',
    );
    expect(renderFiveHour(70)).toContain(
      '<div class="bar band-amber"><div class="bar-fill" style="width: 70%"></div><span class="bar-pct">70%</span></div>',
    );
    expect(renderFiveHour(90)).toContain(
      '<div class="bar band-red"><div class="bar-fill" style="width: 90%"></div><span class="bar-pct">90%</span></div>',
    );
    expect(renderFiveHour(137)).toContain(
      '<div class="bar band-red"><div class="bar-fill" style="width: 100%"></div><span class="bar-pct">137%</span></div>',
    );
  });

  it('caps the visual fill at 100 while the percentage text stays uncapped at 137', () => {
    const zai = renderFiveHour(137);

    expect(zai).toContain('style="width: 100%"'); // fill capped…
    expect(zai).toContain('<p class="hero-percentage">137%</p>'); // …hero text uncapped…
    expect(zai).toContain('<span class="bar-pct">137%</span>'); // …in-bar text uncapped too
  });
});

describe('renderMain — MCP bar from used/ceiling (popup-ui spec)', () => {
  /** Renders the ZAI section for a monitor payload carrying only the MCP window. */
  function renderMcp(mcp: McpWindow): string {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: usage('zai', { kind: 'cost', value: undefined, currency: undefined, windows: { mcp } }),
        },
      },
    };
    return sectionFor(renderMain(popupState({ snapshot })), 'zai');
  }

  it('derives the fill from used/ceiling — 0/1000 renders a 0% green bar and NO percentage text', () => {
    const zai = renderMcp({ used: 0, ceiling: 1000, tools: [] });

    expect(zai).toContain(
      '<div class="bar band-green"><div class="bar-fill" style="width: 0%"></div></div>',
    );
    expect(stripTags(zai)).not.toContain('%'); // the view must not synthesize a percentage
    expect(zai).toContain('MCP: 0 / 1000'); // the line itself stays a plain used/ceiling line
  });

  it('54/60 fills 90% and lands on the red band — MCP bands follow the spec thresholds (≥90 red)', () => {
    const zai = renderMcp({ used: 54, ceiling: 60, tools: [] });

    expect(zai).toContain(
      '<div class="bar band-red"><div class="bar-fill" style="width: 90%"></div></div>',
    );
    expect(zai).toContain('MCP: 54 / 60');
  });

  it('42/60 fills exactly 70% and lands on the amber band (≥70 amber, MCP same bands)', () => {
    const zai = renderMcp({ used: 42, ceiling: 60, tools: [] });

    expect(zai).toContain(
      '<div class="bar band-amber"><div class="bar-fill" style="width: 70%"></div></div>',
    );
  });

  it('caps an over-ceiling MCP fill at 100 with the red band', () => {
    const zai = renderMcp({ used: 90, ceiling: 60, tools: [{ name: 'web-search', used: 90 }] });

    expect(zai).toContain(
      '<div class="bar band-red"><div class="bar-fill" style="width: 100%"></div></div>',
    );
  });
});

describe('renderMain — provider cards (popup-ui spec)', () => {
  it('wraps every provider section in the same card structure', () => {
    const html = renderMain(popupState({ snapshot: FULL_SNAPSHOT }));

    for (const provider of PROVIDERS) {
      expect(html).toContain(`<section class="provider card" data-provider="${provider.id}">`);
    }
  });

  it('settings sections share the card structure for the same visual language', () => {
    const html = renderSettings(popupState({ view: 'settings' }));

    expect(html).toContain('<section class="provider card" data-provider="kimi">');
  });

  it('renders a failed provider as an error card in the same wrapper (structurally consistent)', () => {
    const snapshot: CycleSnapshot = { results: { qwen: { status: 'error', errorClass: 'auth' } } };
    const html = renderMain(popupState({ snapshot }));

    expect(html).toContain('<section class="provider card" data-provider="qwen">');
    const qwen = sectionFor(html, 'qwen');
    expect(qwen).toContain('<h2 class="provider-name">Qwen (Alibaba Cloud BSS)</h2>');
    expect(qwen).toContain('Auth failed'); // per-class label inside the card
  });
});

describe('renderSettings — SETTINGS_GUIDANCE (popup-ui spec §Settings Guidance)', () => {
  it('exports verbatim per-provider copy covering every element of the spec table', () => {
    // Qwen: both fields, Alibaba Cloud Console → RAM → AccessKey pair, the
    // RAM permission, and the DashScope rejection.
    const qwen = SETTINGS_GUIDANCE.qwen;
    expect(qwen).toContain('Access Key ID');
    expect(qwen).toContain('Access Key Secret');
    expect(qwen).toContain('Alibaba Cloud Console');
    expect(qwen).toContain('RAM');
    expect(qwen).toContain('bss:DescribeAcccount');
    expect(qwen).toContain('DashScope sk- keys do not work');

    // OpenAI: admin key, sk-admin- prefix, read scope, org settings, rejection.
    const openai = SETTINGS_GUIDANCE.openai;
    expect(openai).toContain('sk-admin-');
    expect(openai).toContain('read scope');
    expect(openai).toContain('organization settings');
    expect(openai).toContain('project keys are rejected');

    // Kimi: console key; CN and international not interchangeable.
    const kimi = SETTINGS_GUIDANCE.kimi;
    expect(kimi).toContain('Kimi console');
    expect(kimi).toContain('CN');
    expect(kimi).toContain('international');
    expect(kimi).toContain('not interchangeable');

    // ZAI: coding-plan key, same as coding tools, selector, platform-bound.
    const zai = SETTINGS_GUIDANCE.zai;
    expect(zai).toContain('coding-plan');
    expect(zai).toContain('coding tools');
    expect(zai).toContain('Z.AI');
    expect(zai).toContain('ZHIPU');
    expect(zai).toContain('bigmodel.cn');
    expect(zai).toContain('platform-bound');
  });

  it("renders each provider's FULL guidance copy before its input(s), with or without a stored key", () => {
    // qwen has NO stored key; openai HAS one — guidance appears in both.
    const html = renderSettings(
      popupState({
        view: 'settings',
        keyStates: { openai: { type: 'openai-admin-read', maskedToken: '••••1234' } },
      }),
    );

    for (const provider of PROVIDERS) {
      const section = sectionFor(html, provider.id);
      const guidanceAt = section.indexOf(SETTINGS_GUIDANCE[provider.id]);
      const formAt = section.indexOf('<form');
      expect(guidanceAt).toBeGreaterThan(-1); // the full copy renders…
      expect(guidanceAt).toBeLessThan(formAt); // …before the inputs — key-independent
    }
    // Reading order: masked key state first, then the guidance, then the form.
    const openai = sectionFor(html, 'openai');
    expect(openai.indexOf('Stored key:')).toBeLessThan(openai.indexOf(SETTINGS_GUIDANCE.openai));
  });

  it('keeps static guidance and validation errors as separate content (kimi invalid key)', () => {
    const message = 'Credential must not be empty.';
    const html = renderSettings(popupState({ view: 'settings', guidance: { kimi: message } }));
    const kimi = sectionFor(html, 'kimi');

    expect(kimi).toContain('<p class="settings-guidance">'); // static guidance…
    expect(kimi).toContain(SETTINGS_GUIDANCE.kimi); // …full copy
    expect(kimi).toContain(`<p class="guidance" role="alert">${message}</p>`); // …and the validation error, separate
  });
});

describe('Branding footer (popup-ui spec §Branding Footer)', () => {
  const EXPECTED_FOOTER =
    '<footer class="popup-footer">Built by <a href="https://www.thenorthcode.es/" target="_blank" rel="noreferrer">The North Code</a></footer>';

  const extractFooter = (html: string): string =>
    html.slice(html.indexOf('<footer'), html.indexOf('</footer>') + '</footer>'.length);

  it('ends both views with the credit: Built by The North Code → thenorthcode.es', () => {
    for (const html of [renderMain(popupState()), renderSettings(popupState({ view: 'settings' }))]) {
      expect(html).toContain('Built by <a href="https://www.thenorthcode.es/"');
      expect(html).toContain('>The North Code</a>');
    }
  });

  it('renders an identical footer across renders and views of the same state', () => {
    const mainA = renderMain(popupState({ snapshot: FULL_SNAPSHOT }));
    const mainB = renderMain(popupState({ snapshot: FULL_SNAPSHOT }));

    strictEqual(mainA, mainB); // determinism carries the footer
    expect(extractFooter(mainA)).toBe(EXPECTED_FOOTER);
    expect(extractFooter(renderSettings(popupState({ view: 'settings', snapshot: FULL_SNAPSHOT })))).toBe(
      EXPECTED_FOOTER,
    );
  });
});

describe('renderMain — ZAI budget block (popup-ui spec)', () => {
  it('renders level, uncapped percentage with used/total, a distinct countdown element, weekly bar and MCP rows', () => {
    const zai = sectionFor(renderMain(popupState({ snapshot: FULL_SNAPSHOT })), 'zai');

    expect(zai).toContain('Level: Pro');
    // Combined textContent: the 5h line keeps used/total + countdown; the 137
    // itself renders twice — hero above all content, bar-pct in the bar.
    expect(stripTags(zai)).toContain('5h: 16440 / 12000 · Resets in 1h 30m');
    expect(zai).toContain('<p class="hero-percentage">137%</p>');
    // …while the countdown renders as a distinct, prominent element.
    expect(zai).toContain('Resets in <span class="countdown">1h 30m</span>');
    // One bar per window: 5h 137% → red (fill capped, pct overlay), weekly 42% → green.
    expect(zai).toContain(
      '<div class="bar band-red"><div class="bar-fill" style="width: 100%"></div><span class="bar-pct">137%</span></div>',
    );
    expect(zai).toContain('<div class="bar band-green"><div class="bar-fill" style="width: 42%"></div></div>');
    expect(zai).toContain('MCP: 3 / 60');
    expect(zai).toContain('web-search · 2'); // per-tool rows
  });
});

describe('renderMain — dual hero percentage (popup-ui §Provider List Rendering, hito-6)', () => {
  it('renders the uncapped 5h percentage as hero-percentage above all other ZAI card content', () => {
    const zai = sectionFor(renderMain(popupState({ snapshot: FULL_SNAPSHOT })), 'zai');

    // An own element — independently assertable from the in-bar figure.
    expect(zai).toContain('<p class="hero-percentage">137%</p>'); // uncapped: 137, never 100
    // Above all other card content: right after the provider name, before the
    // monitor block and every window line.
    expect(zai.indexOf('class="hero-percentage"')).toBeGreaterThan(zai.indexOf('class="provider-name"'));
    expect(zai.indexOf('class="hero-percentage"')).toBeLessThan(zai.indexOf('class="monitor"'));
    expect(zai.indexOf('class="hero-percentage"')).toBeLessThan(zai.indexOf('5h:'));
  });

  it('renders NO hero on monetary cards — the balance stays the leading figure', () => {
    const html = renderMain(popupState({ snapshot: FULL_SNAPSHOT }));

    for (const id of ['qwen', 'openai', 'kimi'] as const) {
      expect(sectionFor(html, id)).not.toContain('hero-percentage');
    }
    expect(sectionFor(html, 'qwen')).toContain('<p class="usage">¥100.28</p>');
  });

  it('renders NO hero for a monitor card without a 5h percentage — nothing synthesized for MCP', () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: usage('zai', {
            kind: 'cost',
            value: undefined,
            currency: undefined,
            windows: { mcp: { used: 1, ceiling: 5, tools: [] } },
          }),
        },
      },
    };
    expect(sectionFor(renderMain(popupState({ snapshot })), 'zai')).not.toContain('hero-percentage');
  });

  it('rounds the hero display like the line did — 42.6 renders as 43%', () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: usage('zai', {
            kind: 'cost',
            value: undefined,
            currency: undefined,
            windows: { fiveHour: { percentage: 42.6, used: 5_112, total: 12_000 } },
          }),
        },
      },
    };
    expect(sectionFor(renderMain(popupState({ snapshot })), 'zai')).toContain('<p class="hero-percentage">43%</p>');
  });
});

describe('renderMain — in-bar percentage (popup-ui §Provider List Rendering, hito-6)', () => {
  it('carries the same 137 inside the 5h bar as bar-pct while the fill caps at 100', () => {
    const zai = sectionFor(renderMain(popupState({ snapshot: FULL_SNAPSHOT })), 'zai');

    expect(zai).toContain(
      '<div class="bar band-red"><div class="bar-fill" style="width: 100%"></div><span class="bar-pct">137%</span></div>',
    );
    // Hero and in-bar figures are separate elements — trimming one leaves the other.
    expect(zai).toContain('<p class="hero-percentage">137%</p>');
  });

  it('the primary line drops its percentage part — the number renders exactly twice', () => {
    const zai = sectionFor(renderMain(popupState({ snapshot: FULL_SNAPSHOT })), 'zai');

    expect(zai.match(/137%/g)).toHaveLength(2); // hero + bar-pct, never a third copy in the line
    // Secondary info stays below the hero in normal weight.
    expect(stripTags(zai)).toContain('5h: 16440 / 12000 · Resets in 1h 30m');
  });

  it('only the primary bar carries bar-pct — weekly keeps its percentage in the line only', () => {
    const zai = sectionFor(renderMain(popupState({ snapshot: FULL_SNAPSHOT })), 'zai');

    expect((zai.match(/class="bar-pct"/g) ?? []).length).toBe(1);
    expect(zai).toContain('Weekly: 42% · 5040 / 12000');
    expect(zai).toContain(
      '<div class="bar band-green"><div class="bar-fill" style="width: 42%"></div></div>',
    );
  });
});

describe('renderMain — keyless filtering (popup-ui §Provider List Rendering, hito-6)', () => {
  it('a keyless provider renders no main card even with cycle data; settings keeps it unchanged', () => {
    const keyStates: Partial<Record<ProviderId, MaskedCredential | undefined>> = { ...KEYED_STATES, kimi: undefined };
    const main = renderMain(popupState({ snapshot: FULL_SNAPSHOT, keyStates }));

    expect(main).not.toContain('data-provider="kimi"'); // keyless → no card, data or not
    expect(main).toContain('data-provider="zai"'); // keyed providers keep their cards
    expect(main).toContain('data-provider="qwen"');

    const settings = renderSettings(popupState({ view: 'settings', keyStates }));
    expect(settings).toContain('data-provider="kimi"'); // settings still lists everyone
    expect(sectionFor(settings, 'kimi')).toContain('id="key-add-kimi"');
    expect(sectionFor(settings, 'kimi')).toContain(SETTINGS_GUIDANCE.kimi);
  });

  it('a keyed provider with no snapshot entry still renders its card (no-cycle note)', () => {
    const snapshot: CycleSnapshot = { results: { zai: FULL_SNAPSHOT.results.zai! } };
    const html = renderMain(popupState({ snapshot }));

    expect(sectionFor(html, 'kimi')).toContain('No cycle data yet');
    expect(sectionFor(html, 'qwen')).toContain('No cycle data yet');
  });

  it('every provider keyless renders no sections at all — deterministically', () => {
    const state = popupState({ keyStates: {} });
    const html = renderMain(state);

    expect(html).not.toContain('<section');
    expect(html).toContain('data-action="open-settings"'); // header and footer stay
    strictEqual(html, renderMain(state));
  });
});

describe('renderMain — refresh affordance (popup-ui §Manual Refresh Control, hito-6)', () => {
  it('the main header carries a refresh action BEFORE any card content; the settings header does not', () => {
    const main = renderMain(popupState());
    expect(main).toContain('data-action="refresh"');
    expect(main.indexOf('data-action="refresh"')).toBeLessThan(main.indexOf('<section'));

    expect(renderSettings(popupState({ view: 'settings' }))).not.toContain('data-action="refresh"');
  });
});
