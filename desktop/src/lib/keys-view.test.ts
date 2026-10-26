// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeArea } from "../testing/fake-area";
import type { StorageArea } from "@shared/storage/key-store";

import { setupKeysView } from "./keys-view";

const FIXTURE = `
<main>
  <div id="cards" class=""></div>
  <div id="keys">
    <input id="zai-key" />
    <p id="zai-masked"></p>
    <select id="zai-platform"><option value="zai"></option><option value="zhipu"></option></select>
    <button id="zai-save"></button>
    <button id="zai-revoke"></button>
    <input id="qwen-akid" />
    <input id="qwen-aksecret" />
    <p id="qwen-masked"></p>
    <select id="qwen-site"><option value="international"></option><option value="china"></option></select>
    <button id="qwen-save"></button>
    <button id="qwen-revoke"></button>
    <input id="qwen-plan-key" />
    <p id="qwen-plan-masked"></p>
    <button id="qwen-plan-save"></button>
    <button id="qwen-plan-revoke"></button>
    <input id="deepseek-key" />
    <p id="deepseek-masked"></p>
    <button id="deepseek-save"></button>
    <button id="deepseek-revoke"></button>
    <div id="strip-order"></div>
    <select id="strip-orientation"><option value="horizontal"></option><option value="vertical"></option></select>
    <select id="strip-size"><option value="normal"></option><option value="xl"></option></select>
  </div>
</main>
`;

let prefs: StorageArea;
let secrets: StorageArea;
const onKeyChange = vi.fn();
const onLayoutChange = vi.fn();

function tickMacros(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("keys view", () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE;
    prefs = fakeArea();
    secrets = fakeArea();
    onKeyChange.mockClear();
    onLayoutChange.mockClear();
    setupKeysView({
      prefs,
      secrets,
      onKeyChange,
      onLayoutChange,
      stripProviders: () => ["zai", "qwen"],
    });
  });

  it("saves a zai token through KeyStore, clears the input, and masks the display", async () => {
    const input = document.getElementById("zai-key") as HTMLInputElement;
    input.value = "tok-secret-abcd";
    (document.getElementById("zai-save") as HTMLButtonElement).click();
    await tickMacros();

    const stored = await secrets.get("qd:key:zai");
    expect(stored).toEqual({ "qd:key:zai": "tok-secret-abcd" });
    expect(input.value).toBe("");
    expect(document.getElementById("zai-masked")?.textContent).toBe("••••abcd");
    // DOM sweep: the full token never reaches rendered output.
    expect(document.body.innerHTML).not.toContain("tok-secret-abcd");
    expect(onKeyChange).toHaveBeenCalled();
  });

  it("saves the qwen ak/sk pair as one credential and masks both parts", async () => {
    (document.getElementById("qwen-akid") as HTMLInputElement).value = "AKIDEXAMPLE";
    (document.getElementById("qwen-aksecret") as HTMLInputElement).value = "wJalrXUtnFEMIsecret";
    (document.getElementById("qwen-save") as HTMLButtonElement).click();
    await tickMacros();

    const stored = await secrets.get("qd:key:qwen");
    expect(stored).toEqual({
      "qd:key:qwen": { accessKeyId: "AKIDEXAMPLE", accessKeySecret: "wJalrXUtnFEMIsecret" },
    });
    expect(document.getElementById("qwen-masked")?.textContent).toBe(
      "••••MPLE / ••••cret",
    );
    expect(document.body.innerHTML).not.toContain("wJalrXUtnFEMIsecret");
  });

  it("revokes the stored credential", async () => {
    await secrets.set({ "qd:key:zai": "tok-9999" });
    (document.getElementById("zai-revoke") as HTMLButtonElement).click();
    await tickMacros();

    const stored = await secrets.get("qd:key:zai");
    expect(stored).toEqual({});
    expect(document.getElementById("zai-masked")?.textContent).toBe("NO KEY");
    expect(onKeyChange).toHaveBeenCalled();
  });

  it("persists selector changes into the prefs area", async () => {
    const platform = document.getElementById("zai-platform") as HTMLSelectElement;
    platform.value = "zhipu";
    platform.dispatchEvent(new Event("change"));
    await tickMacros();

    const stored = await prefs.get("qd:pref:zai-platform");
    expect(stored).toEqual({ "qd:pref:zai-platform": "zhipu" });
    expect(onKeyChange).toHaveBeenCalled();
  });

  it("saves the DeepSeek bearer key with masked display and DOM sweep", async () => {
    const input = document.getElementById("deepseek-key") as HTMLInputElement;
    input.value = "sk-deepseek-secret-9999";
    (document.getElementById("deepseek-save") as HTMLButtonElement).click();
    await tickMacros();

    const stored = await secrets.get("qd:key:deepseek");
    expect(stored).toEqual({ "qd:key:deepseek": "sk-deepseek-secret-9999" });
    expect(input.value).toBe("");
    expect(document.getElementById("deepseek-masked")?.textContent).toBe("••••9999");
    expect(document.body.innerHTML).not.toContain("sk-deepseek-secret-9999");
  });

  it("renders the strip order list and persists a move", async () => {
    const rows = document.querySelectorAll<HTMLElement>("#strip-order .order-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.dataset.id).toBe("zai");
    expect(rows[1]?.dataset.id).toBe("qwen");

    const qwenUp = rows[1]?.querySelector<HTMLButtonElement>('[data-act="up"]');
    qwenUp?.click();
    await tickMacros();
    await tickMacros();

    const stored = await prefs.get("qd:pref:strip-order");
    expect(stored).toEqual({ "qd:pref:strip-order": ["qwen", "zai"] });
    expect(onLayoutChange).toHaveBeenCalled();
  });

  it("persists orientation and size choices", async () => {
    const orientation = document.getElementById("strip-orientation") as HTMLSelectElement;
    orientation.value = "vertical";
    orientation.dispatchEvent(new Event("change"));
    const size = document.getElementById("strip-size") as HTMLSelectElement;
    size.value = "xl";
    size.dispatchEvent(new Event("change"));
    await tickMacros();

    const stored = await prefs.get(["qd:pref:strip-orientation", "qd:pref:strip-size"]);
    expect(stored["qd:pref:strip-orientation"]).toBe("vertical");
    expect(stored["qd:pref:strip-size"]).toBe("xl");
    expect(onLayoutChange).toHaveBeenCalledTimes(2);
  });
});
