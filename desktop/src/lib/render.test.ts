import { describe, expect, it } from "vitest";

import type { ProviderId } from "@shared/core/provider";
import type { CycleSnapshot } from "@shared/storage/snapshot-store";

import {
  formatCountdown,
  formatSegmentPercentage,
  orderedSegments,
  renderSegments,
  shortName,
  visibleCount,
} from "./render";

const NOW = 1_700_000_000_000;

describe("renderSegments (S8 keyed-only taskbar strip)", () => {
  it("renders one minimalist segment per keyed provider, in stable order", () => {
    const snapshot: CycleSnapshot = {
      results: {
        qwen: { status: "error", errorClass: "auth" },
        zai: {
          status: "ok",
          usage: {
            providerId: "zai",
            kind: "balance",
            fetchedAt: NOW,
            windows: { fiveHour: { percentage: 62, resetAt: NOW + 90 * 60_000 } },
          },
        },
      },
    };
    const html = renderSegments(snapshot, NOW);
    expect(html).toContain(">ZAI<");
    // Number, space, percent sign (S11) — never overlapping.
    expect(html).toContain("62 %");
    expect(html).toContain("RESETS 1h 30m");
    expect(html).toContain(">Qwen<");
    expect(html).toContain("AUTH FAILED");
    // Keyless providers never render (S8).
    expect(html).not.toContain("OpenAI");
    expect(html).not.toContain("Kimi");
    expect(html.indexOf("ZAI")).toBeLessThan(html.indexOf("Qwen"));
  });

  it("renders wallet usage as percentage on top and money-left below", () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: "ok",
          usage: {
            providerId: "zai",
            kind: "balance",
            value: 3.5,
            currency: "CNY",
            fetchedAt: NOW,
            wallet: { currency: "CNY", total: 10, consumed: 6.5, percentage: 65 },
          } as never,
        },
      },
    };
    const html = renderSegments(snapshot, NOW);
    expect(html).toContain("65 %");
    expect(html).toContain("¥3.50 / ¥10.00 LEFT");
  });

  it("uses the qwen quota percentage and reset over the windows", () => {
    const snapshot: CycleSnapshot = {
      results: {
        qwen: {
          status: "ok",
          usage: {
            providerId: "qwen",
            kind: "balance",
            fetchedAt: NOW,
            windows: { fiveHour: { percentage: 10 } },
            quota: { percentage: 137, resetAt: NOW + 86_400_000, fetchedAt: NOW },
          },
        },
      },
    };
    const html = renderSegments(snapshot, NOW);
    expect(html).toContain("137 %");
    expect(html).toContain("color:#ef4444");
    expect(html).toContain("RESETS 1d 0h");
  });

  it("honors the stored order setting (T18)", () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: "ok",
          usage: {
            providerId: "zai",
            kind: "balance",
            fetchedAt: NOW,
            windows: { fiveHour: { percentage: 10 } },
          },
        },
        qwen: {
          status: "ok",
          usage: {
            providerId: "qwen",
            kind: "balance",
            fetchedAt: NOW,
            quota: { percentage: 20, fetchedAt: NOW },
          },
        },
      },
    };
    const html = renderSegments(snapshot, NOW, ["zai", "qwen"], ["qwen", "zai"]);
    expect(html.indexOf(">Qwen<")).toBeLessThan(html.indexOf(">ZAI<"));
  });

  it("orders visible ids: stored order first, then metadata order", () => {
    const snapshot: CycleSnapshot = { results: {} };
    const ids = orderedSegments(snapshot, ["qwen", "zai"], ["qwen"]);
    expect(ids).toEqual(["qwen", "zai"]);
  });

  it("renders a muted NO DATA segment for stored providers without an entry", () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: "ok",
          usage: {
            providerId: "zai",
            kind: "balance",
            fetchedAt: NOW,
            windows: { fiveHour: { percentage: 15 } },
          },
        },
      },
    };
    const html = renderSegments(snapshot, NOW, ["zai", "qwen"]);
    expect(html).toContain(">ZAI<");
    expect(html).toContain(">Qwen<");
    expect(html).toContain("NO DATA THIS TICK");
  });

  it("renders one hint segment when there are no keys at all", () => {
    const html = renderSegments({ results: {} }, NOW);
    expect(html).toContain("NO KEYS YET");
    expect(html).not.toContain("seg-pct");
  });

  it("formats percentage display with a space before the sign", () => {
    expect(formatSegmentPercentage(62.4)).toBe("62 %");
    expect(formatSegmentPercentage(137)).toBe("137 %");
  });

  it("formats countdowns deterministically", () => {
    expect(formatCountdown(NOW, undefined)).toBe("");
    expect(formatCountdown(NOW, NOW - 1)).toBe("NOW");
    expect(formatCountdown(NOW, NOW + 30_000)).toBe("<1m");
    expect(formatCountdown(NOW, NOW + 5 * 60_000)).toBe("5m");
    expect(formatCountdown(NOW, NOW + 90 * 60_000)).toBe("1h 30m");
    expect(formatCountdown(NOW, NOW + 26 * 3_600_000)).toBe("1d 2h");
  });

  it("maps provider ids to short segment names", () => {
    expect(shortName("zai")).toBe("ZAI");
    expect(shortName("qwen")).toBe("Qwen");
    const unknown = "future" as ProviderId;
    expect(shortName(unknown)).toBe("future");
  });

  it("counts visible segments (results + stored) for the strip width", () => {
    expect(visibleCount({ results: {} })).toBe(0);
    expect(visibleCount({ results: { zai: { status: "error", errorClass: "auth" } } })).toBe(1);
    expect(
      visibleCount({ results: { zai: { status: "error", errorClass: "auth" } } }, ["zai", "qwen"]),
    ).toBe(2);
  });
});
