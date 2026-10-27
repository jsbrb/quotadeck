import { describe, expect, it } from "vitest";

import type { ProviderId } from "@shared/core/provider";
import type { ProviderSnapshotEntry } from "@shared/storage/snapshot-store";

import { resolveStripBadge } from "./tray-badge";

const displayName = (id: ProviderId) => id.toUpperCase();

function ok(usage: Record<string, unknown>): ProviderSnapshotEntry {
  return { status: "ok", usage } as unknown as ProviderSnapshotEntry;
}

describe("resolveStripBadge (WU-O: urgent band + full tooltip)", () => {
  it("bands off the MOST urgent provider and lists all figures", () => {
    const results: Partial<Record<ProviderId, ProviderSnapshotEntry>> = {
      zai: ok({
        providerId: "zai",
        kind: "balance",
        windows: { fiveHour: { percentage: 2 } },
      }),
      deepseek: ok({
        providerId: "deepseek",
        kind: "balance",
        wallet: { percentage: 61 },
      }),
    };
    const badge = resolveStripBadge(results, displayName);
    expect(badge.band).toBe("orange");
    expect(badge.tooltip).toBe("QuotaDeck — ZAI 2 % · DEEPSEEK 61 %");
  });

  it("a ≥90 provider turns the band red regardless of order", () => {
    const results: Partial<Record<ProviderId, ProviderSnapshotEntry>> = {
      zai: ok({ providerId: "zai", kind: "balance", windows: { fiveHour: { percentage: 95 } } }),
      qwen: ok({ providerId: "qwen", kind: "balance", quota: { percentage: 10 } }),
    };
    expect(resolveStripBadge(results, displayName).band).toBe("red");
  });

  it("qwen uses its token-plan quota (not the balance windows) for the band", () => {
    const results: Partial<Record<ProviderId, ProviderSnapshotEntry>> = {
      qwen: ok({
        providerId: "qwen",
        kind: "balance",
        windows: { fiveHour: { percentage: 99 } },
        quota: { percentage: 3 },
      }),
    };
    const badge = resolveStripBadge(results, displayName);
    expect(badge.band).toBe("neutral");
    expect(badge.tooltip).toContain("QWEN 3 %");
  });

  it("error entries ride the tooltip as ERR without banding", () => {
    const results: Partial<Record<ProviderId, ProviderSnapshotEntry>> = {
      zai: { status: "error", errorClass: "auth" },
      deepseek: ok({ providerId: "deepseek", kind: "balance", wallet: { percentage: 82 } }),
    };
    const badge = resolveStripBadge(results, displayName);
    expect(badge.band).toBe("deep");
    expect(badge.tooltip).toContain("ZAI ERR");
  });

  it("an empty cycle renders the plain prefix on the neutral band", () => {
    expect(resolveStripBadge({}, displayName)).toEqual({ band: "neutral", tooltip: "QuotaDeck" });
  });
});
