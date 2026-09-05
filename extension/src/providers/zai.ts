// ZAI monitor provider (zai-monitor spec; AD-27; spike evidence in
// docs/spike/endpoints.md).
//
// Endpoint: single-shot GET /api/monitor/usage/quota/limit over the
// platform-selected base (`api.z.ai` default, `open.bigmodel.cn` for ZHIPU —
// AD-28). No pagination, no request body, no query parameters; the engine
// loop simply exits after the first page. Success is a NUMERIC `code` 200
// only — a string "200" is a failure (ProviderApiError; classifies as
// `server` per AD-21).
//
// Parsing (AD-26/27): `data.level` is the plan level. `TOKENS_LIMIT` entries
// discriminate by unit/number — unit 3/number 5 → the 5h window, unit 6/
// number 1 → weekly; when no entry carries the discriminators, position
// decides ([0] → 5h, [1] → weekly). The `TIME_LIMIT` entry is the monthly MCP
// window (currentValue/usage/usageDetails) with NO synthesized percentage or
// countdown. Per window: percentage passes through UNCAPPED, null/absent →
// percentage AND derived used absent, used = round(total × pct / 100) when
// both present, numeric nextResetTime → resetAt verbatim (the countdown
// renders from it at display time). The result carries `windows` only — no
// value/currency/tier (the monitor endpoint reports no monetary figure).
import { ProviderApiError, type PageParse, type Provider, type ProviderState, type UsageQuery } from '../core/provider';
import type { McpToolUsage, McpWindow, MonitorWindows, UsageWindow } from '../core/usage';
import { zaiMonitorBaseUrl, type ZaiPlatform } from '../core/zai-platforms';
import type { ProviderRequest } from '../network/request';
import { asObject } from './parse-utils';

const MONITOR_PATH = '/api/monitor/usage/quota/limit';

/** TOKENS_LIMIT discriminator for the 5-hour window (community-pinned, O3). */
const FIVE_HOUR_UNIT = 3;
const FIVE_HOUR_NUMBER = 5;
/** TOKENS_LIMIT discriminator for the weekly window (community-pinned, O3). */
const WEEKLY_UNIT = 6;
const WEEKLY_NUMBER = 1;

function isZaiPlatform(value: unknown): value is ZaiPlatform {
  return value === 'zai' || value === 'zhipu';
}

/** Finite-number passthrough: anything else (null, absent, NaN) is absent. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * TOKENS_LIMIT entry → UsageWindow. Absent (undefined) when `total` is
 * missing — a window without its quota ceiling cannot be formed. A null or
 * absent percentage suppresses the percentage AND the derived used; used is
 * round(total × percentage / 100) when both are present (AD-27).
 */
function parseUsageWindow(entry: Record<string, unknown>): UsageWindow | undefined {
  const total = finiteNumber(entry.total);
  if (total === undefined) {
    return undefined;
  }
  const percentage = finiteNumber(entry.percentage);
  const used = percentage !== undefined ? Math.round((total * percentage) / 100) : undefined;
  const resetAt = finiteNumber(entry.nextResetTime);
  return {
    ...(percentage !== undefined ? { percentage } : {}),
    ...(used !== undefined ? { used } : {}),
    total,
    ...(resetAt !== undefined ? { resetAt } : {}),
  };
}

/**
 * TIME_LIMIT entry → McpWindow: currentValue (used), usage (ceiling),
 * usageDetails (per-tool map) with tools sorted by name for determinism.
 * Absent when currentValue/usage are not both finite. No percentage, no
 * countdown — never synthesized (spec §Monthly MCP Window).
 */
function parseMcpWindow(entry: Record<string, unknown>): McpWindow | undefined {
  const used = finiteNumber(entry.currentValue);
  const ceiling = finiteNumber(entry.usage);
  if (used === undefined || ceiling === undefined) {
    return undefined;
  }
  const details = asObject(entry.usageDetails);
  const tools: McpToolUsage[] = [];
  if (details !== null) {
    for (const [name, value] of Object.entries(details)) {
      const toolUsed = finiteNumber(value);
      if (toolUsed !== undefined) {
        tools.push({ name, used: toolUsed });
      }
    }
  }
  tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { used, ceiling, tools };
}

export class ZaiProvider implements Provider {
  readonly id = 'zai' as const;
  readonly displayName = 'ZAI (Zhipu AI)';
  /** Raw attach: the stored key verbatim, no Bearer prefix (AD-25). */
  readonly credentialType = 'raw' as const;

  firstRequest(query: UsageQuery): ProviderRequest {
    // Runtime discipline: the platform reaches here through storage reads, so
    // an invalid stored value must fail HERE — before any dispatch.
    const platform: unknown = query.zaiPlatform ?? 'zai';
    if (!isZaiPlatform(platform)) {
      throw new Error(`ZAI requires zaiPlatform 'zai' | 'zhipu', got ${JSON.stringify(platform)}.`);
    }
    return { method: 'GET', url: `${zaiMonitorBaseUrl(platform)}${MONITOR_PATH}` };
  }

  parsePage(body: unknown, _state: ProviderState | null): PageParse {
    const root = asObject(body);
    const code = root?.code;
    if (root === null || typeof code !== 'number' || code !== 200) {
      throw new ProviderApiError(
        `ZAI monitor failed: success requires numeric code 200, got ${code === undefined ? 'no code' : `${typeof code} ${JSON.stringify(code)}`}.`,
      );
    }
    const data = asObject(root.data);
    // Mutable builder — handed to the result as the readonly MonitorWindows.
    const windows: { level?: string; fiveHour?: UsageWindow; weekly?: UsageWindow; mcp?: McpWindow } = {};
    const level = data?.level;
    if (typeof level === 'string' && level.length > 0) {
      windows.level = level;
    }

    const rawLimits = data === null ? undefined : data.tokenLimits;
    const entries = (Array.isArray(rawLimits) ? rawLimits : [])
      .map(asObject)
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    const tokens = entries.filter((entry) => entry.type === 'TOKENS_LIMIT');
    const time = entries.find((entry) => entry.type === 'TIME_LIMIT');

    let fiveHourEntry = tokens.find((entry) => entry.unit === FIVE_HOUR_UNIT && entry.number === FIVE_HOUR_NUMBER);
    let weeklyEntry = tokens.find((entry) => entry.unit === WEEKLY_UNIT && entry.number === WEEKLY_NUMBER);
    if (fiveHourEntry === undefined && weeklyEntry === undefined) {
      // Positional fallback (spec §Level and Window Discrimination): entries
      // omitting the discriminators map by position among TOKENS_LIMITs.
      fiveHourEntry = tokens[0];
      weeklyEntry = tokens[1];
    }
    const fiveHour = fiveHourEntry === undefined ? undefined : parseUsageWindow(fiveHourEntry);
    const weekly = weeklyEntry === undefined ? undefined : parseUsageWindow(weeklyEntry);
    const mcp = time === undefined ? undefined : parseMcpWindow(time);

    if (fiveHour !== undefined) {
      windows.fiveHour = fiveHour;
    }
    if (weekly !== undefined) {
      windows.weekly = weekly;
    }
    if (mcp !== undefined) {
      windows.mcp = mcp;
    }

    return {
      done: true,
      usage: {
        providerId: 'zai',
        kind: 'cost',
        windows,
        // Placeholder: the refresh engine stamps the fold time from the injected Clock (AD-1).
        fetchedAt: 0,
      },
    };
  }
}
