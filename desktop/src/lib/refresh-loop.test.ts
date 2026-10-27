import { describe, expect, it } from "vitest";

import type { Provider, ProviderId, UsageQuery } from "@shared/core/provider";
import type { ProviderRegistry } from "@shared/core/registry";
import type { AuthorizedRequest, Transport, TransportResponse } from "@shared/network/transport";
import type { StorageArea } from "@shared/storage/key-store";
import type { CycleSnapshot } from "@shared/storage/snapshot-store";

import { buildDesktopTickQuery, runDesktopRefreshTick } from "./refresh-loop";
import { fakeArea } from "../testing/fake-area";

function fakeTransport(responses: Record<string, TransportResponse> = {}): Transport & { calls: AuthorizedRequest[] } {
  const calls: AuthorizedRequest[] = [];
  return {
    calls,
    async fetch(request) {
      calls.push(request);
      const response = responses[request.url];
      if (response === undefined) {
        throw new Error(`no fixture routed for ${request.url}`);
      }
      return response;
    },
  };
}

const FIXED_NOW = 1_700_000_000_000;
const fakeClock = { now: () => FIXED_NOW, sleep: async () => {} };

const zaiProvider: Provider = {
  id: "zai",
  displayName: "ZAI (Zhipu AI)",
  credentialType: "raw",
  firstRequest: () => ({ method: "GET", url: "https://api.z.ai/usage", headers: {} }),
  parsePage: () => ({
    done: true,
    usage: { providerId: "zai", kind: "balance", fetchedAt: 0 },
  }),
};

function registryOf(providers: readonly Provider[]): ProviderRegistry {
  return {
    ids: () => providers.map((provider) => provider.id),
    get: (id: ProviderId) => {
      const provider = providers.find((entry) => entry.id === id);
      if (provider === undefined) {
        throw new Error(`unknown provider ${id}`);
      }
      return provider;
    },
  } as unknown as ProviderRegistry;
}

function snapshotOf(prefs: StorageArea): Promise<CycleSnapshot | undefined> {
  return prefs.get("qd:snapshot").then((items) => items["qd:snapshot"] as CycleSnapshot | undefined);
}

describe("buildDesktopTickQuery", () => {
  it("derives the trailing 24h window from the injected clock", () => {
    const query = buildDesktopTickQuery(fakeClock, "zai", "international");
    const expected: UsageQuery = {
      zaiPlatform: "zai",
      qwenSite: "international",
      now: FIXED_NOW,
      startTime: 1_700_000_000 - 86_400,
      endTime: 1_700_000_000,
    };
    expect(query).toEqual(expected);
  });
});

describe("runDesktopRefreshTick", () => {
  it("skips keyless providers, dispatches nothing, and persists the empty cycle", async () => {
    const prefs = fakeArea();
    const secrets = fakeArea();
    const transport = fakeTransport();

    const outcome = await runDesktopRefreshTick({
      prefs,
      secrets,
      transport,
      clock: fakeClock,
      registry: registryOf([zaiProvider]),
    });

    expect(transport.calls).toHaveLength(0);
    const snapshot = await snapshotOf(prefs);
    expect(snapshot?.results).toEqual({});
    expect(outcome.badgeProvider).toBe("zai");
  });

  it("refreshes a keyed provider live and records the ok entry with the clock stamp", async () => {
    const prefs = fakeArea();
    const secrets = fakeArea({ "qd:key:zai": "tok-1234" });
    const transport = fakeTransport({
      "https://api.z.ai/usage": { status: 200, body: { ok: true } },
    });

    const outcome = await runDesktopRefreshTick({
      prefs,
      secrets,
      transport,
      clock: fakeClock,
      registry: registryOf([zaiProvider]),
    });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.url).toBe("https://api.z.ai/usage");
    const entry = outcome.snapshot.results.zai;
    expect(entry?.status).toBe("ok");
    if (entry?.status === "ok") {
      expect(entry.usage.fetchedAt).toBe(FIXED_NOW);
    }
    const persisted = await snapshotOf(prefs);
    expect(persisted?.results.zai?.status).toBe("ok");
  });

  it("records a taxonomy class when the refresh throws", async () => {
    const prefs = fakeArea();
    const secrets = fakeArea({ "qd:key:zai": "tok-1234" });
    const transport = fakeTransport(); // no fixture → transport-level failure

    const outcome = await runDesktopRefreshTick({
      prefs,
      secrets,
      transport,
      clock: fakeClock,
      registry: registryOf([zaiProvider]),
    });

    const entry = outcome.snapshot.results.zai;
    expect(entry?.status).toBe("error");
    if (entry?.status === "error") {
      expect(typeof entry.errorClass).toBe("string");
      expect(entry.errorClass.length).toBeGreaterThan(0);
    }
  });

  it("quarantine (qwenDisabled) skips both qwen steps entirely", async () => {
    // Post-incident rule: with qwenDisabled, no qwen dispatch happens at all
    // (plan probe + token-plan quota are the only qwen paths on this base).
    const prefs = fakeArea();
    const secrets = fakeArea();
    const transport = fakeTransport();

    const outcome = await runDesktopRefreshTick({
      prefs,
      secrets,
      transport,
      clock: fakeClock,
      registry: registryOf([zaiProvider]),
      qwenDisabled: true,
    });

    expect(transport.calls).toHaveLength(0);
    expect(outcome.snapshot.results.qwen).toBeUndefined();
    const persisted = await snapshotOf(prefs);
    expect(persisted?.results.qwen).toBeUndefined();
  });
});
