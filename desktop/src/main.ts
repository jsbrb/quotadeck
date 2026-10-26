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
// Segment geometry must match the CSS custom properties (index.html):
// normal = taskbar height 48px tight; xl = 68px with maxed fonts (S12).
const SEG_SIZE = { normal: { width: 180, height: 48 }, xl: { width: 230, height: 68 } } as const;
const BAR_PAD_X = 16;
const BAR_PAD_Y = 16;
const REFRESH_SEGMENT_WIDTH = 44;
const EMPTY_SEGMENTS = 1;
const LAST_TICK_ERROR_KEY = "qd:last-tick-error";
// Trailing refresh segment (S12): manual reload without waiting for the tick.
const REFRESH_SEGMENT_HTML = `
    <div class="seg seg-refresh">
      <button id="refresh-btn" type="button" aria-label="Refresh quotas now">⟳</button>
    </div>`;

const bar = document.getElementById("bar");
const keysView = document.getElementById("keys");

const prefs = createPrefsArea();
const secrets = createSecretsArea();
// WU-K: gateway requests carry the session cookies of the embedded Qwen
// console sign-in window (Rust reads them from that webview's jar — memory
// only, never persisted, never logged).
const transport = createDesktopTransport(async () =>
  invoke<null | string>("qwen_gateway_cookies").catch(() => null),
);
const clock = new SystemClock();

let mode: "bar" | "keys" = "bar";
let demoMode = false;
let layout: StripLayout = { order: [], orientation: "horizontal", size: "normal" };
let lastSnapshot: CycleSnapshot = { results: {} };
let lastStored: ProviderId[] = [];
let lastVisibleCount = 0;
let lastHints: Partial<Record<ProviderId, string>> = {};

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
    const height = BAR_PAD_Y + count * seg.height + seg.height;
    void invoke("reflow_flyout", { width, height });
    return;
  }
  const width = BAR_PAD_X + count * seg.width + REFRESH_SEGMENT_WIDTH;
  void invoke("reflow_flyout", { width, height: seg.height });
}

function renderBar(): void {
  if (bar === null) {
    return;
  }
  bar.innerHTML =
    renderSegments(lastSnapshot, clock.now(), lastStored, layout.order, lastHints) +
    REFRESH_SEGMENT_HTML;
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

/**
 * Muted-segment hints (WU-K): a stored qwen without an entry AND without a
 * live sign-in window means the session was never started — tell the user
 * exactly that instead of the generic NO DATA.
 */
async function buildHints(): Promise<Partial<Record<ProviderId, string>>> {
  const hints: Partial<Record<ProviderId, string>> = {};
  if (lastStored.includes("qwen") && lastSnapshot.results.qwen === undefined) {
    const cookies = await invoke<null | string>("qwen_gateway_cookies").catch(() => null);
    if (cookies === null) {
      hints.qwen = "SIGN IN VIA TRAY MENU";
    }
  }
  return hints;
}

async function tick(): Promise<void> {
  try {
    const outcome = await runDesktopRefreshTick({ prefs, secrets, transport, clock });
    await refreshLayout();
    lastSnapshot = outcome.snapshot;
    lastStored = await storedProviders();
    lastVisibleCount = visibleCount(lastSnapshot, lastStored);
    lastHints = await buildHints();
    await prefs.remove(LAST_TICK_ERROR_KEY).catch(() => {});
    if (mode === "bar") {
      renderBar();
      reflowBar();
    }
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

// Delegated wiring: survives bar re-renders (innerHTML swaps the segments).
bar?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>("#refresh-btn");
  if (button !== null && !demoMode && !button.disabled) {
    button.disabled = true;
    button.textContent = "…";
    void tick().finally(() => {
      button.disabled = false;
      button.textContent = "⟳";
    });
  }
});

document.getElementById("keys-close")?.addEventListener("click", () => {
  showBar();
});

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
