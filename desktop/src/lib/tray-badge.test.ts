import { describe, expect, it } from "vitest";

import type { ProviderId } from "@shared/core/provider";
import type { ProviderSnapshotEntry } from "@shared/storage/snapshot-store";

import { resolveChosenBand } from "./tray-badge";

function okUsage(usage: Record<string, unknown>): ProviderSnapshotEntry {
  return {
    status: "ok",
    usage: { providerId: "zai", kind: "balance", fetchedAt: 0, ...usage },
  } as ProviderSnapshotEntry;
}

const NAMES: Partial<Record<ProviderId, string>> = {
  zai: "ZAI (Zhipu AI)",
  qwen: "Qwen (Alibaba Cloud BSS)",
};
const displayName = (id: ProviderId) => NAMES[id] ?? id;

describe("resolveChosenBand", () => {
  it("maps the zai 5h percentage onto the threshold bands", () => {
    const results = { zai: okUsage({ windows: { fiveHour: { percentage: 137 } } }) };
    expect(resolveChosenBand(results, "zai", displayName)).toEqual({
      band: "red",
      tooltip: "QuotaDeck — ZAI (Zhipu AI) 137%",
    });
    const calm = { zai: okUsage({ windows: { fiveHour: { percentage: 30 } } }) };
    expect(resolveChosenBand(calm, "zai", displayName).band).toBe("neutral");
    const warm = { zai: okUsage({ windows: { fiveHour: { percentage: 62 } } }) };
    expect(resolveChosenBand(warm, "zai", displayName).band).toBe("orange");
    const hot = { zai: okUsage({ windows: { fiveHour: { percentage: 85 } } }) };
    expect(resolveChosenBand(hot, "zai", displayName).band).toBe("deep");
  });

  it("uses the qwen quota percentage when present", () => {
    const results = {
      zai: okUsage({ windows: { fiveHour: { percentage: 10 } } }),
      qwen: {
        status: "ok",
        usage: { providerId: "qwen", kind: "balance", fetchedAt: 0, quota: { percentage: 62, fetchedAt: 0 } },
      },
    } as Partial<Record<ProviderId, ProviderSnapshotEntry>>;
    const chosen = resolveChosenBand(results, "qwen", displayName);
    expect(chosen).toEqual({
      band: "orange",
      tooltip: "QuotaDeck — Qwen (Alibaba Cloud BSS) 62%",
    });
  });

  it("renders neutral with an ERR tooltip for the chosen provider's error", () => {
    const results = { zai: { status: "error", errorClass: "auth" } } as Partial<Record<ProviderId, ProviderSnapshotEntry>>;
    expect(resolveChosenBand(results, "zai", displayName)).toEqual({
      band: "neutral",
      tooltip: "QuotaDeck — ERR",
    });
  });

  it("renders plain neutral for an absent entry or an unshipped choice", () => {
    expect(resolveChosenBand({}, "zai", displayName)).toEqual({ band: "neutral", tooltip: "QuotaDeck" });
    expect(resolveChosenBand({ zai: okUsage({ windows: { fiveHour: { percentage: 95 } } }) }, "kimi", displayName)).toEqual({
      band: "neutral",
      tooltip: "QuotaDeck",
    });
  });
});
