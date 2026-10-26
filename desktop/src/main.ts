import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SystemClock } from "@shared/core/clock";
import type { ProviderId } from "@shared/core/provider";
import { SnapshotStore, type CycleSnapshot } from "@shared/storage/snapshot-store";
import { createPrefsArea, createSecretsArea } from "./lib/desktop-storage";
import { createDesktopTransport } from "./lib/desktop-transport";
import { setupKeysView } from "./lib/keys-view";
import { renderSegments, renderTickNotice, shortName, visibleCount } from "./lib/render";
import { runDesktopRefreshTick } from "./lib/refresh-loop";
import { readStripLayout, type StripLayout } from "./lib/strip-prefs";
import { resolveChosenBand } from "./lib/tray-badge";

// Second-taskbar shell (WU-L): dark strip of EQUAL-SIZED minimalist segments,
// one per configured provider (S8). Orientation (horizontal row / vertical
// right-edge column) and size (normal = taskbar height 48px / xl) are user
// settings in KEYS; the window chrome stays at zero — all controls live in
// the tray menu.

const REFRESH_PERIOD_MS = 60_000;
// Segment geometry must match the CSS custom properties (index.html).
const SEG_SIZE = { normal: { width: 230, height: 48 }, xl: { width: 300, height: 96 } } as const;
const BAR_PAD_X = 16;
const BAR_PAD_Y = 16;
const EMPTY_SEGMENTS = 1;
const LAST_TICK_ERROR_KEY = "qd:last-tick-error";

// Boot diagnostics: an uncaught module error surfaces in the window title so
// a headless debug session can read it via the process list.
window.addEventListener("error", (event) => {
  document.title = `BOOT ERR: ${event.message}`;
});

// T12 diagnostic (temporary): the shared qwen steps swallow failures by
// contract and only log to console.error — capture those lines so the
// headless debug session can read the exact failure class from prefs.
const capturedErrors: string[] = [];
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const line = args
    .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  capturedErrors.push(line.slice(0, 200));
  if (capturedErrors.length > 20) {
    capturedErrors.shift();
  }
  originalConsoleError(...args);
};

const bar = document.getElementById("bar");
const keysView = document.getElementById("keys");

const prefs = createPrefsArea();
const secrets = createSecretsArea();
const transport = createDesktopTransport();
const clock = new SystemClock();

let mode: "bar" | "keys" = "bar";
let demoMode = false;
let layout: StripLayout = { order: [], orientation: "horizontal", size: "normal" };
let lastSnapshot: CycleSnapshot = { results: {} };
let lastStored: ProviderId[] = [];
let lastVisibleCount = 0;

async function refreshLayout(): Promise<void> {
  layout = await readStripLayout(prefs);
  document.body.dataset.size = layout.size;
  document.body.dataset.orientation = layout.orientation;
}

/**
 * Deterministic window size from segment count + layout (S9/S10/S11): the
 * horizontal strip grows leftward from the bottom-right dock; the vertical
 * column grows upward from the same dock. SEG_SIZE mirrors the CSS vars.
 */
function reflowBar(): void {
  const count = Math.max(lastVisibleCount, EMPTY_SEGMENTS);
  const seg = SEG_SIZE[layout.size];
  if (layout.orientation === "vertical") {
    const width = seg.width + BAR_PAD_X;
    const height = BAR_PAD_Y + count * seg.height;
    void invoke("reflow_flyout", { width, height });
    return;
  }
  const width = BAR_PAD_X + count * seg.width;
  void invoke("reflow_flyout", { width, height: seg.height });
}

function renderBar(): void {
  if (bar === null) {
    return;
  }
  bar.innerHTML = renderSegments(lastSnapshot, clock.now(), lastStored, layout.order);
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

async function tick(): Promise<void> {
  try {
    const outcome = await runDesktopRefreshTick({ prefs, secrets, transport, clock });
    await refreshLayout();
    lastSnapshot = outcome.snapshot;
    lastStored = await storedProviders();
    lastVisibleCount = visibleCount(lastSnapshot, lastStored);
    await prefs.remove(LAST_TICK_ERROR_KEY).catch(() => {});
    if (mode === "bar") {
      renderBar();
      reflowBar();
    }
    await prefs
      .set({ "qd:console-log": [...capturedErrors] })
      .catch(() => {});
    // The tray icon IS the desktop badge: band color from ZAI's threshold,
    // figure in the tooltip.
    const chosen = resolveChosenBand(outcome.snapshot.results, "zai", shortName);
    await invoke("set_tray_badge", { band: chosen.band, tooltip: chosen.tooltip });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[quotadeck-desktop] tick failed:", error);
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
  onLayoutChange: () => {
    // Layout edits reflow/re-render without a network tick.
    void (async () => {
      await refreshLayout();
      lastVisibleCount = visibleCount(lastSnapshot, lastStored);
      if (mode === "bar") {
        renderBar();
        reflowBar();
      }
    })();
  },
  stripProviders: () => lastStored,
});

// Demo mode (QUOTADECK_DEMO=1): render the seeded snapshot and freeze — no
// ticks, no key-save refresh. A normal launch runs the live loop.
void (async () => {
  await refreshLayout();
  if (await invoke<boolean>("is_demo")) {
    demoMode = true;
    const snapshot = await new SnapshotStore(prefs).read();
    if (snapshot !== undefined) {
      lastSnapshot = snapshot;
      lastVisibleCount = visibleCount(snapshot);
    }
    renderBar();
    showBar();
    return;
  }
  showBar();
  void tick();
  setInterval(() => {
    void tick();
  }, REFRESH_PERIOD_MS);
})();
