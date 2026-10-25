import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SystemClock } from "@shared/core/clock";
import type { ProviderId } from "@shared/core/provider";
import { SnapshotStore } from "@shared/storage/snapshot-store";
import { createPrefsArea, createSecretsArea } from "./lib/desktop-storage";
import { createDesktopTransport } from "./lib/desktop-transport";
import { setupKeysView } from "./lib/keys-view";
import { renderSegments, renderTickNotice, shortName, visibleCount } from "./lib/render";
import { runDesktopRefreshTick } from "./lib/refresh-loop";
import { resolveChosenBand } from "./lib/tray-badge";

// Second-taskbar shell (WU-G): the window IS a dark strip, one minimalist
// segment per keyed provider (S8/S9). All controls live in the tray menu —
// the strip itself has zero chrome. Rust owns the KEYS window size; the
// frontend owns the strip width from the keyed count.

const REFRESH_PERIOD_MS = 60_000;
const SEG_WIDTH = 230;
const BAR_HEIGHT = 68;
const BAR_PAD_X = 16;
const EMPTY_BAR_WIDTH = 330;
const LAST_TICK_ERROR_KEY = "qd:last-tick-error";

// Boot diagnostics: an uncaught module error surfaces in the window title so
// a headless debug session can read it via the process list.
window.addEventListener("error", (event) => {
  document.title = `BOOT ERR: ${event.message}`;
});

const bar = document.getElementById("bar");
const keysView = document.getElementById("keys");

const prefs = createPrefsArea();
const secrets = createSecretsArea();
const transport = createDesktopTransport();
const clock = new SystemClock();

let mode: "bar" | "keys" = "bar";
let demoMode = false;
let lastKeyedCount = 0;

/**
 * Provider ids with a stored credential slot (S8 "stored keys render"):
 * `qd:key:qwen-plan` maps to `qwen` — a plan-only user sees the Qwen segment.
 */
async function storedProviders(): Promise<ProviderId[]> {
  const ids = new Set<ProviderId>();
  for (const key of Object.keys(await secrets.get(null))) {
    if (!key.startsWith("qd:key:")) {
      continue;
    }
    const slot = key.slice("qd:key:".length);
    ids.add(slot === "qwen-plan" ? "qwen" : (slot as ProviderId));
  }
  return [...ids];
}

function reflowBar(): void {
  const width =
    lastKeyedCount === 0
      ? EMPTY_BAR_WIDTH
      : BAR_PAD_X + lastKeyedCount * SEG_WIDTH;
  void invoke("reflow_flyout", { width, height: BAR_HEIGHT });
}

function showBar(): void {
  mode = "bar";
  bar?.classList.remove("hidden");
  keysView?.classList.add("hidden");
  reflowBar();
}

function showKeys(): void {
  mode = "keys";
  bar?.classList.add("hidden");
  keysView?.classList.remove("hidden");
  // The KEYS window size is owned by the Rust tray-menu handler.
}

async function tick(): Promise<void> {
  try {
    const outcome = await runDesktopRefreshTick({ prefs, secrets, transport, clock });
    const stored = await storedProviders();
    lastKeyedCount = visibleCount(outcome.snapshot, stored);
    await prefs.remove(LAST_TICK_ERROR_KEY).catch(() => {});
    if (mode === "bar" && bar !== null) {
      bar.innerHTML = renderSegments(outcome.snapshot, clock.now(), stored);
    }
    if (mode === "bar") {
      reflowBar();
    }
    // The tray icon IS the desktop badge: band color from ZAI's threshold,
    // figure in the tooltip. No badge choice — the segments carry every
    // provider already (S10).
    const chosen = resolveChosenBand(outcome.snapshot.results, "zai", shortName);
    await invoke("set_tray_badge", { band: chosen.band, tooltip: chosen.tooltip });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[quotadeck-desktop] tick failed:", error);
    // Persist for diagnosis; the strip shows the notice instead of dying.
    await prefs.set({ [LAST_TICK_ERROR_KEY]: { message, at: clock.now() } }).catch(() => {});
    if (mode === "bar" && bar !== null) {
      bar.innerHTML = renderTickNotice(message);
    }
  }
}

void listen("quotadeck://show-bar", () => showBar());
void listen("quotadeck://show-keys", () => showKeys());

setupKeysView({
  prefs,
  secrets,
  onKeyChange: () => {
    if (!demoMode) {
      void tick();
    }
  },
});

// Demo mode (QUOTADECK_DEMO=1): render the seeded snapshot and freeze — no
// ticks, no key-save refresh. A normal launch runs the live loop.
void (async () => {
  if (await invoke<boolean>("is_demo")) {
    demoMode = true;
    const snapshot = await new SnapshotStore(prefs).read();
    if (snapshot !== undefined && bar !== null) {
      bar.innerHTML = renderSegments(snapshot, Date.now());
      lastKeyedCount = visibleCount(snapshot);
    }
    showBar();
    return;
  }
  showBar();
  void tick();
  setInterval(() => {
    void tick();
  }, REFRESH_PERIOD_MS);
})().catch((error: unknown) => {
  document.title = `BOOT ERR: ${error instanceof Error ? error.message : String(error)}`;
});
