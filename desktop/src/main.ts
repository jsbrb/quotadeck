import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SystemClock } from "@shared/core/clock";
import type { ProviderId } from "@shared/core/provider";
import { SnapshotStore, type CycleSnapshot } from "@shared/storage/snapshot-store";
import { createPrefsArea, createSecretsArea } from "./lib/desktop-storage";
import { createDesktopTransport, gatewayProbe } from "./lib/desktop-transport";
import { setupKeysView } from "./lib/keys-view";
import { renderSegments, renderTickNotice, shortName, visibleCount } from "./lib/render";
import { runDesktopRefreshTick } from "./lib/refresh-loop";
import { readStripLayout, stripGeometry, writeStripOrientation, type StripLayout } from "./lib/strip-prefs";
import { applyLayoutToBar } from "./lib/strip-view";
import { resolveStripBadge } from "./lib/tray-badge";

// Second-taskbar shell (WU-L): dark strip of EQUAL-SIZED minimalist segments,
// one per configured provider (S8). Orientation (horizontal row / vertical
// right-edge column) and size (normal = taskbar height 48px / xl) are user
// settings in KEYS; the window chrome stays at zero — all controls live in
// the tray menu.

const REFRESH_PERIOD_MS = 60_000;
// Geometry lives in strip-prefs.ts (stripGeometry + SEG_SIZE), mirrored by
// the CSS custom properties on #bar (index.html) — WU-N.
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
  if (bar !== null) {
    applyLayoutToBar(bar, layout);
  }
}

/**
 * Deterministic window size from segment count + layout (S9/S10/S11) —
 * stripGeometry() is the pure, unit-tested source of the matrix.
 */
function reflowBar(): void {
  const geometry = stripGeometry(layout, lastVisibleCount);
  void invoke("reflow_flyout", { width: geometry.width, height: geometry.height });
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
    // The tray icon IS the desktop badge (WU-O): band from the most urgent
    // provider, tooltip listing every provider's figure.
    const badge = resolveStripBadge(outcome.snapshot.results, shortName);
    await invoke("set_tray_badge", { band: badge.band, tooltip: badge.tooltip });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * WU-O autotest (QUOTADECK_AUTOTEST=1): self-reproduces the user-reported
 * scenarios — live orientation flips through the REAL Keys controls (bar
 * mode and the Keys→✕ path), a refresh click, tray-icon churn counting, and
 * the Qwen gateway probe — then writes a `qd:autotest` report with boolean
 * verdicts for scripts/autotest-desktop.ps1. No human repetition required.
 */
async function runAutotest(): Promise<void> {
  const report: Record<string, unknown> = {};
  /**
   * Window size AFTER the OS settles: reflow_flyout is fire-and-forget, so
   * poll for a STABLE size (two equal reads 150ms apart) after an initial
   * settle. Each snapshot also carries the logical `expected` geometry and
   * the device pixel ratio so a failure distinguishes "windowing bug" from
   * "measurement artifact" (expected_physical = expected * dpr).
   */
  const stableWindow = async (): Promise<[number, number] | null> => {
    await sleep(1200);
    let prev = await invoke<null | [number, number]>("flyout_size").catch(() => null);
    for (let attempt = 0; attempt < 14; attempt += 1) {
      await sleep(150);
      const next = await invoke<null | [number, number]>("flyout_size").catch(() => null);
      if (prev !== null && next !== null && prev[0] === next[0] && prev[1] === next[1]) {
        return next;
      }
      prev = next;
    }
    return prev;
  };
  const snap = async (name: string): Promise<void> => {
    report[name] = {
      pref: layout.orientation,
      barClass: bar?.className ?? null,
      barInline: bar?.style.flexDirection ?? null,
      computed: bar !== null ? getComputedStyle(bar).flexDirection : null,
      expected: stripGeometry(layout, lastVisibleCount),
      dpr: window.devicePixelRatio,
      window: await stableWindow(),
    };
  };
  const computedOf = (name: string): string | null => {
    const s = report[name] as { computed?: unknown } | undefined;
    return typeof s?.computed === "string" ? s.computed : null;
  };
  /** OS window size must equal the expected logical geometry * dpr (±4px). */
  const sizeMatches = (name: string): boolean => {
    const s = report[name] as
      | { window?: [number, number] | null; expected?: { width: number; height: number }; dpr?: number }
      | undefined;
    if (!s || s.window === null || s.window === undefined || !s.expected || !s.dpr) {
      return false;
    }
    const tolerance = 4 * s.dpr;
    return (
      Math.abs(s.window[0] - s.expected.width * s.dpr) <= tolerance &&
      Math.abs(s.window[1] - s.expected.height * s.dpr) <= tolerance
    );
  };

  await writeStripOrientation(prefs, "horizontal");
  await refreshLayout();
  renderBar();
  showBar();
  await tick();
  await snap("boot");

  const sel = document.getElementById("strip-orientation") as HTMLSelectElement | null;
  if (sel !== null) {
    sel.value = "vertical";
    sel.dispatchEvent(new Event("change"));
  }
  await sleep(700);
  await snap("flipVerticalInBar");
  if (sel !== null) {
    sel.value = "horizontal";
    sel.dispatchEvent(new Event("change"));
  }
  await sleep(700);
  await snap("flipBackHorizontal");

  // The user path: open Keys via ✕-able flow, flip there, close with ✕.
  showKeys();
  if (sel !== null) {
    sel.value = "vertical";
    sel.dispatchEvent(new Event("change"));
  }
  await sleep(500);
  document.getElementById("keys-close")?.click();
  await sleep(700);
  await snap("keysFlipThenClose");

  // Tray-icon churn: two consecutive badge writes with the same band must
  // swap the icon at most once (the suspected cause of the vanished icon).
  const statsBefore = await invoke<[number, number]>("tray_stats").catch(() => null);
  (document.getElementById("refresh-btn") as HTMLButtonElement | null)?.click();
  await sleep(2500);
  const statsAfter = await invoke<[number, number]>("tray_stats").catch(() => null);
  report.refresh = { before: statsBefore, after: statsAfter };

  if (lastStored.includes("qwen")) {
    report.qwen = {
      cookieCounts: await invoke<[number, number]>("qwen_cookie_counts").catch(() => null),
      gatewayProbe: gatewayProbe.last,
      entry: lastSnapshot.results.qwen ?? null,
    };
  }

  report.verdicts = {
    flipVerticalDOM: computedOf("flipVerticalInBar") === "column",
    flipVerticalWindowMatches: sizeMatches("flipVerticalInBar"),
    flipBackDOM: computedOf("flipBackHorizontal") === "row",
    flipBackWindowMatches: sizeMatches("flipBackHorizontal"),
    keysFlipDOM: computedOf("keysFlipThenClose") === "column",
    keysFlipWindowMatches: sizeMatches("keysFlipThenClose"),
    refreshReported: statsBefore !== null && statsAfter !== null,
    noIconChurn: statsBefore !== null && statsAfter !== null && statsBefore[1] === statsAfter[1],
  };

  await writeStripOrientation(prefs, "horizontal");
  await refreshLayout();
  renderBar();
  reflowBar();
  await prefs.set({ "qd:autotest": { ...report, finishedAt: clock.now() } });
}

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
  if (await invoke<boolean>("is_autotest")) {
    await runAutotest();
    return;
  }
  showBar();
  void tick();
  setInterval(() => {
    void tick();
  }, REFRESH_PERIOD_MS);
})();
