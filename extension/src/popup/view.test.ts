// Popup view tests (popup-ui spec §Settings Gear Surface, §Per-Model
// Consumption View, §ZAI Platform Selector; AD-22/26/27/28) — node
// environment by design (AD-11): the view is a pure string-producing module,
// so determinism is plain strict string equality.
import { strictEqual } from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import type { ProviderId } from '../core/provider';
import type { ErrorClass } from '../refresh/error-taxonomy';
import { currencySymbol, type McpWindow, type MonitorWindows, type NormalizedUsage } from '../core/usage';
import type { CycleSnapshot } from '../storage/snapshot-store';
import {
  escapeHtml,
  formatResetCountdown,
  formatUsageText,
  type PopupProvider,
  type PopupState,
  renderMain,
  renderSettings,
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
    keyStates: {},
    guidance: {},
    nowMs: NOW_MS,
    zaiPlatform: 'zai',
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
    // combined textContent (the countdown span splits the raw string)
    expect(stripTags(zai)).toContain('5h: 137% · 16440 / 12000 · Resets in 1h 30m'); // 137 stays 137 — uncapped
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

    expect(zai).toContain('5h: 43% · 12000 total'); // Math.round(42.6) for display; no used part
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
    expect(stripTags(zai)).toContain('5h: 32% · Resets in 1h 30m'); // no used/total part — nothing to render
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
      snapshot: fullSnapshot, // bars via the monitor windows
      guidance: { kimi: 'Credential must not be empty.' },
      keyStates: { qwen: { type: 'ak-sk', maskedAccessKeyId: '••••AK00', maskedAccessKeySecret: '••••0000' } },
    });
    const mainA = renderMain(state);
    const settingsA = renderSettings({ ...state, view: 'settings' });

    strictEqual(mainA, renderMain(state));
    strictEqual(settingsA, renderSettings({ ...state, view: 'settings' }));
    expect(mainA).toContain('class="bar '); // the compared output actually carries bars…
    expect(settingsA).toContain('Credential must not be empty.'); // …and guidance
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
    expect(renderFiveHour(55)).toContain(
      '<div class="bar band-green"><div class="bar-fill" style="width: 55%"></div></div>',
    );
    expect(renderFiveHour(70)).toContain(
      '<div class="bar band-amber"><div class="bar-fill" style="width: 70%"></div></div>',
    );
    expect(renderFiveHour(90)).toContain(
      '<div class="bar band-red"><div class="bar-fill" style="width: 90%"></div></div>',
    );
    expect(renderFiveHour(137)).toContain(
      '<div class="bar band-red"><div class="bar-fill" style="width: 100%"></div></div>',
    );
  });

  it('caps the visual fill at 100 while the percentage text stays uncapped at 137', () => {
    const zai = renderFiveHour(137);

    expect(zai).toContain('style="width: 100%"'); // fill capped…
    expect(stripTags(zai)).toContain('5h: 137%'); // …text uncapped
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

describe('renderMain — ZAI budget block (popup-ui spec)', () => {
  it('renders level, uncapped percentage with used/total, a distinct countdown element, weekly bar and MCP rows', () => {
    const zai = sectionFor(renderMain(popupState({ snapshot: FULL_SNAPSHOT })), 'zai');

    expect(zai).toContain('Level: Pro');
    // Combined textContent is byte-preserved…
    expect(stripTags(zai)).toContain('5h: 137% · 16440 / 12000 · Resets in 1h 30m'); // 137 stays 137 — uncapped
    // …while the countdown renders as a distinct, prominent element.
    expect(zai).toContain('Resets in <span class="countdown">1h 30m</span>');
    // One bar per window: 5h 137% → red (fill capped), weekly 42% → green.
    expect(zai).toContain('<div class="bar band-red"><div class="bar-fill" style="width: 100%"></div></div>');
    expect(zai).toContain('<div class="bar band-green"><div class="bar-fill" style="width: 42%"></div></div>');
    expect(zai).toContain('MCP: 3 / 60');
    expect(zai).toContain('web-search · 2'); // per-tool rows
  });
});
