import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { createPrefsArea, createSecretsArea } from "./desktop-storage";

describe("RpcArea (desktop StorageArea adapters)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("reads back a set value through the area's command pair", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "prefs_read_all" ? {} : undefined,
    );
    const area = createPrefsArea();

    await area.set({ "qd:pref:badge-provider": "zai" });
    const read = await area.get("qd:pref:badge-provider");

    expect(read).toEqual({ "qd:pref:badge-provider": "zai" });
    const writeCall = invokeMock.mock.calls.find(([cmd]) => cmd === "prefs_write_all");
    expect(writeCall).toBeDefined();
    expect(writeCall?.[1]).toEqual({
      items: { "qd:pref:badge-provider": "zai" },
    });
  });

  it("returns only present keys for array and null reads", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "prefs_read_all"
        ? { "qd:snapshot": { results: {} }, "qd:pref:badge-provider": "zai" }
        : undefined,
    );
    const area = createPrefsArea();

    expect(await area.get(["qd:snapshot", "qd:missing"])).toEqual({
      "qd:snapshot": { results: {} },
    });
    expect(await area.get(null)).toEqual({
      "qd:snapshot": { results: {} },
      "qd:pref:badge-provider": "zai",
    });
  });

  it("remove deletes the key and persists the remaining map", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "secrets_read_all"
        ? { "qd:key:zai": "token-1234", "qd:key:qwen": "token-5678" }
        : undefined,
    );
    const area = createSecretsArea();

    await area.remove("qd:key:zai");
    const read = await area.get(["qd:key:zai", "qd:key:qwen"]);

    expect(read).toEqual({ "qd:key:qwen": "token-5678" });
    const writeCall = invokeMock.mock.calls.find(([cmd]) => cmd === "secrets_write_all");
    expect(writeCall?.[1]).toEqual({ items: { "qd:key:qwen": "token-5678" } });
  });

  it("round-trips structured credentials (ak-sk pair objects)", async () => {
    // The mock simulates the Rust side: secrets_read_all replays whatever a
    // previous secrets_write_all persisted, verbatim.
    const lastWritten: Record<string, unknown> = {};
    invokeMock.mockImplementation(async (cmd: string, args?: { items?: Record<string, unknown> }) => {
      if (cmd === "secrets_read_all") {
        return { ...lastWritten };
      }
      if (cmd === "secrets_write_all" && args?.items) {
        Object.assign(lastWritten, args.items);
      }
      return undefined;
    });

    const area = createSecretsArea();
    const pair = {
      accessKeyId: "AKIDEXAMPLE",
      accessKeySecret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCY",
    };
    await area.set({ "qd:key:qwen": pair });

    const credential = await area.get("qd:key:qwen");
    expect(credential).toEqual({ "qd:key:qwen": pair });
  });

  it("keeps prefs and secrets areas independent", async () => {
    const stores: Record<string, Record<string, unknown>> = {};
    invokeMock.mockImplementation(async (cmd: string, args?: { items?: Record<string, unknown> }) => {
      const kind = cmd.startsWith("prefs") ? "prefs" : "secrets";
      if (cmd.endsWith("read_all")) {
        return { ...(stores[kind] ?? {}) };
      }
      if (args?.items) {
        stores[kind] = { ...(stores[kind] ?? {}), ...args.items };
      }
      return undefined;
    });

    const prefs = createPrefsArea();
    const secrets = createSecretsArea();
    await prefs.set({ "qd:snapshot": { results: {} } });
    await secrets.set({ "qd:key:zai": "token-abcd" });

    expect(await prefs.get(null)).toEqual({ "qd:snapshot": { results: {} } });
    expect(await secrets.get(null)).toEqual({ "qd:key:zai": "token-abcd" });
  });
});
