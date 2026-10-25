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
    <select id="badge-provider"><option value="zai"></option><option value="qwen"></option></select>
  </div>
</main>
`;

let prefs: StorageArea;
let secrets: StorageArea;
const onKeyChange = vi.fn();

function tickMacros(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("keys view", () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE;
    prefs = fakeArea();
    secrets = fakeArea();
    onKeyChange.mockClear();
    setupKeysView({ prefs, secrets, onKeyChange });
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
});
