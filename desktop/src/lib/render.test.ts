import { describe, expect, it } from "vitest";

import type { CycleSnapshot } from "@shared/storage/snapshot-store";

import { keyedCount, renderSnapshot } from "./render";

const NOW = 1_700_000_000_000;

describe("renderSnapshot (S8 keyed-only strip)", () => {
  it("renders only keyed providers, in stable metadata order", () => {
    const snapshot: CycleSnapshot = {
      results: {
        qwen: { status: "error", errorClass: "auth" },
        zai: {
          status: "ok",
          usage: { providerId: "zai", kind: "balance", fetchedAt: NOW, windows: { fiveHour: { percentage: 62 } } },
        },
      },
    };
    const html = renderSnapshot(snapshot, NOW);
    expect(html).toContain("ZAI (Zhipu AI)");
    expect(html).toContain("62%");
    expect(html).toContain("Qwen (Alibaba Cloud BSS)");
    expect(html).toContain("Auth failed");
    // Keyless providers never render (S8).
    expect(html).not.toContain("OpenAI");
    expect(html).not.toContain("Kimi");
    expect(html).not.toContain("NO KEY");
    // Stable order: metadata order first (zai before qwen).
    expect(html.indexOf("ZAI")).toBeLessThan(html.indexOf("Qwen"));
  });

  it("renders one hint card when there are no keys at all", () => {
    const html = renderSnapshot({ results: {} }, NOW);
    expect(html).toContain("NO KEYS YET");
    expect(html).not.toContain("provider-name");
  });

  it("carries the LAST KNOWN chip on error cards", () => {
    const snapshot: CycleSnapshot = {
      results: { zai: { status: "error", errorClass: "network" } },
      lastKnown: {
        zai: {
          status: "ok",
          usage: { providerId: "zai", kind: "balance", fetchedAt: NOW - 300_000 },
        },
      },
    };
    const html = renderSnapshot(snapshot, NOW);
    expect(html).toContain("LAST KNOWN T-5m");
    expect(html).toContain("Network error");
  });

  it("counts keyed providers for the strip width", () => {
    expect(keyedCount({ results: {} })).toBe(0);
    expect(keyedCount({ results: { zai: { status: "error", errorClass: "auth" } } })).toBe(1);
  });
});
