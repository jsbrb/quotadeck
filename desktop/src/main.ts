import { invoke } from "@tauri-apps/api/core";
import { SystemClock } from "@shared/core/clock";
import { createPrefsArea, createSecretsArea } from "./lib/desktop-storage";
import { createDesktopTransport } from "./lib/desktop-transport";
import { displayName, keyedCount, renderSnapshot, renderTickError } from "./lib/render";
import { setupKeysView } from "./lib/keys-view";
import { runDesktopRefreshTick } from "./lib/refresh-loop";
import { resolveChosenBand } from "./lib/tray-badge";

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

// Strip sizing (S9): deterministic width from the keyed card count — no DOM
// measurement feedback loops. KEYS gets its own taller transient window.
const CARD_WIDTH = 190;
const CARD_GAP = 12;
const STRIP_PAD_X = 28;
const STRIP_HEIGHT = 170;
const KEYS_WIDTH = 680;
const KEYS_HEIGHT = 560;

let activeQuotas = true;
let lastKeyedCount = 0;

function reflowQuotas(): void {
  const count = Math.max(lastKeyedCount, 1);
  const width = STRIP_PAD_X + count * CARD_WIDTH + (count - 1) * CARD_GAP;
  void invoke("reflow_flyout", { width, height: STRIP_HEIGHT });
}

function reflowKeys(): void {
  void invoke("reflow_flyout", { width: KEYS_WIDTH, height: KEYS_HEIGHT });
}

function showTab(quotas: boolean): void {
  activeQuotas = quotas;
  cards?.classList.toggle("hidden", !quotas);
  keysView?.classList.toggle("hidden", quotas);
  tabQuotas?.classList.toggle("active", quotas);
  tabKeys?.classList.toggle("active", !quotas);
  if (quotas) {
    reflowQuotas();
  } else {
    reflowKeys();
  }
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
    lastKeyedCount = keyedCount(outcome.snapshot);
    if (activeQuotas) {
      reflowQuotas();
    }
    // The tray icon IS the desktop badge (WU-E): band color from the chosen
    // provider's threshold, figure in the tooltip.
    const chosen = resolveChosenBand(outcome.snapshot.results, outcome.badgeProvider, displayName);
    await invoke("set_tray_badge", { band: chosen.band, tooltip: chosen.tooltip });
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
