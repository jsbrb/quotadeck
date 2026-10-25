import { invoke } from "@tauri-apps/api/core";
import { SystemClock } from "@shared/core/clock";
import { createPrefsArea, createSecretsArea } from "./lib/desktop-storage";
import { createDesktopTransport } from "./lib/desktop-transport";
import { setupKeysView } from "./lib/keys-view";
import { renderSnapshot, renderTickError } from "./lib/render";
import { runDesktopRefreshTick } from "./lib/refresh-loop";

// Flyout shell (WU-D): pin toggle talks to the Rust shell; QUOTAS/KEYS tabs
// switch views; the refresh loop runs here on the extension's One-Minute
// cadence (S6) and re-renders the cards after every cycle.

const REFRESH_PERIOD_MS = 60_000;

const cards = document.getElementById("cards");
const keysView = document.getElementById("keys");
const tabQuotas = document.querySelector<HTMLButtonElement>("#tab-quotas");
const tabKeys = document.querySelector<HTMLButtonElement>("#tab-keys");
const pinButton = document.querySelector<HTMLButtonElement>("#pin");
let pinned = false;

pinButton?.addEventListener("click", () => {
  pinned = !pinned;
  pinButton.setAttribute("aria-pressed", String(pinned));
  pinButton.classList.toggle("pinned", pinned);
  pinButton.textContent = pinned ? "UNPIN" : "PIN";
  void invoke("set_pinned", { pinned });
});

function showTab(quotas: boolean): void {
  cards?.classList.toggle("hidden", !quotas);
  keysView?.classList.toggle("hidden", quotas);
  tabQuotas?.classList.toggle("active", quotas);
  tabKeys?.classList.toggle("active", !quotas);
}

tabQuotas?.addEventListener("click", () => showTab(true));
tabKeys?.addEventListener("click", () => showTab(false));

const prefs = createPrefsArea();
const secrets = createSecretsArea();
const transport = createDesktopTransport();
const clock = new SystemClock();

async function tick(): Promise<void> {
  try {
    const outcome = await runDesktopRefreshTick({ prefs, secrets, transport, clock });
    if (cards !== null) {
      cards.innerHTML = renderSnapshot(outcome.snapshot, clock.now());
    }
  } catch (error) {
    console.error("[quotadeck-desktop] tick failed:", error);
    if (cards !== null) {
      cards.innerHTML = renderTickError(error);
    }
  }
}

void tick();
setInterval(() => {
  void tick();
}, REFRESH_PERIOD_MS);

setupKeysView({ prefs, secrets, onKeyChange: () => void tick() });
