// Keys view (T6) — the desktop equivalent of the extension popup's KEYS tab.
//
// Same contract as the popup (key-storage / popup-ui specs): credentials are
// written ONLY through KeyStore (the single home for key material — here the
// secrets area backed by Windows Credential Manager), display reads go
// exclusively through readMaskedCredential (full keys never reach the DOM),
// inputs clear the moment a credential is accepted, and revoke removes the
// stored credential.

import type { ProviderId } from "@shared/core/provider";
import { KeyStore, type StorageArea } from "@shared/storage/key-store";
import { readBadgeProvider, writeBadgeProvider } from "@shared/storage/badge-provider-store";
import { readQwenSite, writeQwenSite } from "@shared/storage/qwen-site-store";
import { readZaiPlatform, writeZaiPlatform } from "@shared/storage/zai-platform-store";

export interface KeysViewDeps {
  readonly prefs: StorageArea;
  readonly secrets: StorageArea;
  /** Called after any change that should trigger a fresh tick. */
  readonly onKeyChange: () => void;
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`missing #${id} in the keys view markup`);
  }
  return el as T;
}

function setStatus(el: HTMLElement, message: string, isError: boolean): void {
  el.textContent = message;
  el.classList.toggle("error", isError);
}

export function setupKeysView(deps: KeysViewDeps): void {
  const keys = new KeyStore(deps.secrets);
  const prefs = deps.prefs;

  const zaiKey = requireEl<HTMLInputElement>("zai-key");
  const zaiMasked = requireEl("zai-masked");
  const zaiPlatform = requireEl<HTMLSelectElement>("zai-platform");
  const zaiSave = requireEl("zai-save");
  const zaiRevoke = requireEl("zai-revoke");

  const qwenAkId = requireEl<HTMLInputElement>("qwen-akid");
  const qwenAkSecret = requireEl<HTMLInputElement>("qwen-aksecret");
  const qwenMasked = requireEl("qwen-masked");
  const qwenSite = requireEl<HTMLSelectElement>("qwen-site");
  const qwenSave = requireEl("qwen-save");
  const qwenRevoke = requireEl("qwen-revoke");

  const qwenPlanKey = requireEl<HTMLInputElement>("qwen-plan-key");
  const qwenPlanMasked = requireEl("qwen-plan-masked");
  const qwenPlanSave = requireEl("qwen-plan-save");
  const qwenPlanRevoke = requireEl("qwen-plan-revoke");

  const badgeProvider = requireEl<HTMLSelectElement>("badge-provider");

  async function refreshMasks(): Promise<void> {
    const zai = await keys.readMaskedCredential("zai", "raw");
    zaiMasked.textContent =
      zai === undefined || zai.type === "ak-sk" ? "NO KEY" : zai.maskedToken;

    const qwen = await keys.readMaskedCredential("qwen", "ak-sk");
    qwenMasked.textContent =
      qwen === undefined || qwen.type !== "ak-sk"
        ? "NO KEY"
        : `${qwen.maskedAccessKeyId} / ${qwen.maskedAccessKeySecret}`;

    const plan = await keys.readMaskedCredential("qwen-plan", "qwen-plan");
    qwenPlanMasked.textContent =
      plan === undefined || plan.type === "ak-sk" ? "NO KEY" : plan.maskedToken;
  }

  zaiSave.addEventListener("click", () => {
    const token = zaiKey.value;
    void keys
      .saveCredential("zai", { type: "raw", token })
      .then(() => {
        zaiKey.value = "";
        setStatus(zaiMasked, "", false);
        return refreshMasks().then(deps.onKeyChange);
      })
      .catch((error: unknown) => {
        setStatus(zaiMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  zaiRevoke.addEventListener("click", () => {
    void keys
      .revokeCredential("zai")
      .then(refreshMasks)
      .then(deps.onKeyChange)
      .catch((error: unknown) => {
        setStatus(zaiMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  qwenSave.addEventListener("click", () => {
    const accessKeyId = qwenAkId.value;
    const accessKeySecret = qwenAkSecret.value;
    void keys
      .saveCredential("qwen", { type: "ak-sk", accessKeyId, accessKeySecret })
      .then(() => {
        qwenAkId.value = "";
        qwenAkSecret.value = "";
        setStatus(qwenMasked, "", false);
        return refreshMasks().then(deps.onKeyChange);
      })
      .catch((error: unknown) => {
        setStatus(qwenMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  qwenRevoke.addEventListener("click", () => {
    void keys
      .revokeCredential("qwen")
      .then(refreshMasks)
      .then(deps.onKeyChange)
      .catch((error: unknown) => {
        setStatus(qwenMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  qwenPlanSave.addEventListener("click", () => {
    const token = qwenPlanKey.value;
    void keys
      .saveCredential("qwen-plan", { type: "qwen-plan", token })
      .then(() => {
        qwenPlanKey.value = "";
        setStatus(qwenPlanMasked, "", false);
        return refreshMasks().then(deps.onKeyChange);
      })
      .catch((error: unknown) => {
        setStatus(qwenPlanMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  qwenPlanRevoke.addEventListener("click", () => {
    void keys
      .revokeCredential("qwen-plan")
      .then(refreshMasks)
      .then(deps.onKeyChange)
      .catch((error: unknown) => {
        setStatus(qwenPlanMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  // Selectors persist immediately and re-tick: the platform/site choice is
  // the base URL of the very next dispatch (AD-28 parity).
  zaiPlatform.addEventListener("change", () => {
    void writeZaiPlatform(prefs, zaiPlatform.value as "zai" | "zhipu").then(deps.onKeyChange);
  });
  qwenSite.addEventListener("change", () => {
    void writeQwenSite(prefs, qwenSite.value as "international" | "china").then(deps.onKeyChange);
  });
  badgeProvider.addEventListener("change", () => {
    void writeBadgeProvider(prefs, badgeProvider.value as ProviderId);
  });

  // Initial paint: stored selections + masked states.
  void readZaiPlatform(prefs).then((platform) => {
    zaiPlatform.value = platform;
  });
  void readQwenSite(prefs).then((site) => {
    qwenSite.value = site;
  });
  void readBadgeProvider(prefs).then((provider) => {
    badgeProvider.value = provider;
  });
  void refreshMasks();
}
