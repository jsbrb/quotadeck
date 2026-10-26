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
import { readQwenSite, writeQwenSite } from "@shared/storage/qwen-site-store";
import { readZaiPlatform, writeZaiPlatform } from "@shared/storage/zai-platform-store";
import { shortName } from "./render";
import {
  readStripLayout,
  writeStripOrientation,
  writeStripOrder,
  writeStripSize,
  type StripOrientation,
  type StripSize,
} from "./strip-prefs";

export interface KeysViewDeps {
  readonly prefs: StorageArea;
  readonly secrets: StorageArea;
  /** Called after any change that should trigger a fresh tick. */
  readonly onKeyChange: () => void;
  /** Called after a strip layout change (no network tick needed). */
  readonly onLayoutChange: () => void;
  /** Providers with stored keys — the strip order list source (S8). */
  readonly stripProviders: () => ProviderId[];
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

  function afterKeyChange(): void {
    void renderOrderList();
    deps.onKeyChange();
  }

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

  const deepseekKey = requireEl<HTMLInputElement>("deepseek-key");
  const deepseekMasked = requireEl("deepseek-masked");
  const deepseekSave = requireEl("deepseek-save");
  const deepseekRevoke = requireEl("deepseek-revoke");

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

    const deepseek = await keys.readMaskedCredential("deepseek", "bearer");
    deepseekMasked.textContent =
      deepseek === undefined || deepseek.type === "ak-sk" ? "NO KEY" : deepseek.maskedToken;
  }

  zaiSave.addEventListener("click", () => {
    const token = zaiKey.value;
    void keys
      .saveCredential("zai", { type: "raw", token })
      .then(() => {
        zaiKey.value = "";
        setStatus(zaiMasked, "", false);
        return refreshMasks().then(afterKeyChange);
      })
      .catch((error: unknown) => {
        setStatus(zaiMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  zaiRevoke.addEventListener("click", () => {
    void keys
      .revokeCredential("zai")
      .then(refreshMasks)
      .then(afterKeyChange)
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
        return refreshMasks().then(afterKeyChange);
      })
      .catch((error: unknown) => {
        setStatus(qwenMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  qwenRevoke.addEventListener("click", () => {
    void keys
      .revokeCredential("qwen")
      .then(refreshMasks)
      .then(afterKeyChange)
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
        return refreshMasks().then(afterKeyChange);
      })
      .catch((error: unknown) => {
        setStatus(qwenPlanMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  qwenPlanRevoke.addEventListener("click", () => {
    void keys
      .revokeCredential("qwen-plan")
      .then(refreshMasks)
      .then(afterKeyChange)
      .catch((error: unknown) => {
        setStatus(qwenPlanMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  deepseekSave.addEventListener("click", () => {
    const token = deepseekKey.value;
    void keys
      .saveCredential("deepseek", { type: "bearer", token })
      .then(() => {
        deepseekKey.value = "";
        setStatus(deepseekMasked, "", false);
        return refreshMasks().then(afterKeyChange);
      })
      .catch((error: unknown) => {
        setStatus(deepseekMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  deepseekRevoke.addEventListener("click", () => {
    void keys
      .revokeCredential("deepseek")
      .then(refreshMasks)
      .then(afterKeyChange)
      .catch((error: unknown) => {
        setStatus(deepseekMasked, error instanceof Error ? error.message : String(error), true);
      });
  });

  // Selectors persist immediately and re-tick: the platform/site choice is
  // the base URL of the very next dispatch (AD-28 parity).
  zaiPlatform.addEventListener("change", () => {
    void writeZaiPlatform(prefs, zaiPlatform.value as "zai" | "zhipu").then(afterKeyChange);
  });
  qwenSite.addEventListener("change", () => {
    void writeQwenSite(prefs, qwenSite.value as "international" | "china").then(afterKeyChange);
  });

  // --- TRAY STRIP settings (WU-L): order, orientation, size. ---
  const orderList = requireEl("strip-order");
  const orientationSel = requireEl<HTMLSelectElement>("strip-orientation");
  const sizeSel = requireEl<HTMLSelectElement>("strip-size");

  function currentOrder(): ProviderId[] {
    const visible = deps.stripProviders();
    const listed = orderList.querySelectorAll<HTMLElement>(".order-row");
    const out: ProviderId[] = [];
    for (const row of listed) {
      const id = row.dataset.id;
      if (id !== undefined && visible.includes(id as ProviderId)) {
        out.push(id as ProviderId);
      }
    }
    return [...out, ...visible.filter((id) => !out.includes(id))];
  }

  async function renderOrderList(): Promise<void> {
    const { order } = await readStripLayout(prefs);
    const visible = deps.stripProviders();
    const listed = order.filter((id) => visible.includes(id));
    const full: ProviderId[] = [...listed, ...visible.filter((id) => !listed.includes(id))];
    if (full.length === 0) {
      orderList.innerHTML = '<p class="row">NO PROVIDERS CONFIGURED YET</p>';
      return;
    }
    orderList.innerHTML = full
      .map(
        (id, index) =>
          `<div class="order-row" data-id="${id}">` +
          `<span class="order-name">${index + 1}. ${shortName(id)}</span>` +
          `<button type="button" data-act="up" aria-label="Move ${shortName(id)} up">▲</button>` +
          `<button type="button" data-act="down" aria-label="Move ${shortName(id)} down">▼</button>` +
          `</div>`,
      )
      .join("");
    for (const button of orderList.querySelectorAll<HTMLButtonElement>(".order-row button")) {
      button.addEventListener("click", () => {
        const row = button.closest<HTMLElement>(".order-row");
        const id = row?.dataset.id as ProviderId | undefined;
        if (id === undefined) {
          return;
        }
        const ids = currentOrder();
        const from = ids.indexOf(id);
        const to = button.dataset.act === "up" ? from - 1 : from + 1;
        if (from < 0 || to < 0 || to >= ids.length) {
          return;
        }
        const swapped = [...ids];
        const tmp = swapped[from];
        if (tmp !== undefined && swapped[to] !== undefined) {
          swapped[from] = swapped[to];
          swapped[to] = tmp;
        }
        void writeStripOrder(prefs, swapped)
          .then(renderOrderList)
          .then(deps.onLayoutChange);
      });
    }
  }

  orientationSel.addEventListener("change", () => {
    void writeStripOrientation(prefs, orientationSel.value as StripOrientation).then(
      deps.onLayoutChange,
    );
  });
  sizeSel.addEventListener("change", () => {
    void writeStripSize(prefs, sizeSel.value as StripSize).then(deps.onLayoutChange);
  });

  // Initial paint: stored selections + masked states. The tray badge has no
  // selector by design (S10): it always renders ZAI.
  void readZaiPlatform(prefs).then((platform) => {
    zaiPlatform.value = platform;
  });
  void readQwenSite(prefs).then((site) => {
    qwenSite.value = site;
  });
  void readStripLayout(prefs).then(({ orientation, size }) => {
    orientationSel.value = orientation;
    sizeSel.value = size;
  });
  void renderOrderList();
  void refreshMasks();
}
