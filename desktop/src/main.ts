import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SystemClock } from "@shared/core/clock";
import type { ProviderId } from "@shared/core/provider";
import { SnapshotStore, type CycleSnapshot } from "@shared/storage/snapshot-store";
import { createPrefsArea, createSecretsArea } from "./lib/desktop-storage";
import { createDesktopTransport, gatewayProbe } from "./lib/desktop-transport";
import { setupKeysView } from "./lib/keys-view";
import { qwenUsageProbeBody, qwenUsageProbeUrl } from "./lib/qwen-probe";
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
// WU-P: the gateway hop runs INSIDE the hidden Qwen console webview (real
// Chromium TLS + the console Origin — the shape the WAF accepts). Falls back
// to the plain plugin-http hop while the agent warms up.
const transport = createDesktopTransport(async ({ url, method, authorization, body }) => {
  const result = await invoke<null | { s: number; c: string; b: string }>("qwen_gateway_fetch", {
    url,
    method,
    authorization,
    body: body ?? null,
  }).catch(() => null);
  return result === null ? null : { status: result.s, contentType: result.c, text: result.b };
});
const clock = new SystemClock();

// ── Spike WU-U: qwen cookie-hop probe ──────────────────────────────────────
// The browser-hop WITH an Authorization header is CORS-walled: a custom
// header forces a preflight and the gateway never allows the console origin.
// The console web app itself reads quotas with plain session cookies — so the
// probe replays the EXACT hop-2 usage request (pinned twin in qwen-probe.ts)
// with NO Authorization header and credentials: "include" (the Rust hop
// switches modes when auth is absent). Two content-type variants separate a
// preflight wall from a response wall. Results land in the
// `qd:qwen-cookie-probe` pref for offline reading — the spike is measured,
// never guessed. Quarantine: never runs in autotest/demo mode.
const QWEN_COOKIE_PROBE_KEY = "qd:qwen-cookie-probe";

interface QwenCookieProbeArm {
  status: number;
  contentType: string;
  bodyPrefix: string;
  errorText?: string;
}

async function runQwenCookieProbe(reason: string): Promise<void> {
  if (demoMode || qwenQuarantine) {
    return;
  }
  const arm = async (label: string, contentType: string): Promise<QwenCookieProbeArm> => {
    const result = await invoke<null | { s: number; c: string; b: string }>("qwen_gateway_fetch", {
      url: qwenUsageProbeUrl(),
      method: "POST",
      authorization: null,
      body: qwenUsageProbeBody(),
      contentType,
    }).catch((error: unknown) => {
      return { __invokeError: String(error) };
    });
    if (result !== null && typeof result === "object" && "__invokeError" in result) {
      console.error(`[quotadeck-desktop] qwen cookie probe (${label}) invoke failed:`, result.__invokeError);
      return {
        status: -1,
        contentType: "ipc-error",
        bodyPrefix: "",
        errorText: String(result.__invokeError).slice(0, 300),
      };
    }
    // The Rust command returns Option<(u16, String, String)> — a JSON ARRAY
    // over IPC, not an object. Normalize before reading fields.
    const hop = Array.isArray(result)
      ? { s: result[0], c: result[1], b: result[2] }
      : result;
    return {
      status: hop?.s ?? 0,
      contentType: hop?.c ?? "invoke-null",
      bodyPrefix: (hop?.b ?? "").slice(0, 400),
    };
  };
  const formSimple = await arm("form-simple", "application/x-www-form-urlencoded");
  const jsonPreflight = await arm("json-preflight", "application/json");
  await prefs.set({
    [QWEN_COOKIE_PROBE_KEY]: { at: clock.now(), reason, formSimple, jsonPreflight },
  });
}

let mode: "bar" | "keys" = "bar";
let demoMode = false;
let layout: StripLayout = { order: [], orientation: "horizontal", size: "normal" };
let lastSnapshot: CycleSnapshot = { results: {} };
let lastStored: ProviderId[] = [];
let lastVisibleCount = 0;
let lastHints: Partial<Record<ProviderId, string>> = {};
// Post-incident quarantine: qwen hops back off exponentially after gateway
// blocks so the desktop can NEVER degrade the Chrome extension through
// shared-account server-side rate control (the reported outage).
let qwenBackoffUntil = 0;
let qwenFailures = 0;
const QWEN_BACKOFF_BASE_MS = 15 * 60_000;
const QWEN_BACKOFF_MAX_MS = 60 * 60_000;
let qwenQuarantine = false; // AUTOTEST only: zero qwen dispatches
let browserHopBlocked = false; // WU-Q: a REAL browser-hop got WAF-blocked
let lastRefreshAt = 0;

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
  renderBar();
  reflowBar();
}

function showKeys(): void {
  mode = "keys";
  bar?.classList.add("hidden");
  keysView?.classList.remove("hidden");
  // The KEYS window GROWS with its content (S12: no scroll can hide the ✕):
  // measure the laid-out grid and reflow, capped by the monitor work area.
  void (async () => {
    await sleep(30); // let the hidden->visible layout pass settle
    const head = document.querySelector<HTMLElement>(".keys-head");
    const grid = document.querySelector<HTMLElement>(".keys-grid");
    const measured =
      (head?.offsetHeight ?? 0) + (grid?.scrollHeight ?? 0) + 38;
    const work = await invoke<[number, number]>("work_area_size").catch(() => null);
    const cap = work === null ? 900 : work[1] - 80;
    const width = work === null ? 680 : Math.min(680, work[0] - 40);
    const height = Math.max(360, Math.min(measured, cap));
    await invoke("reflow_flyout", { width, height }).catch(() => {});
  })();
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
 * Muted-segment hints (WU-P): a stored qwen without an entry reports the
 * gateway probe's verdict — WAF block, agent warm-up, or plain no-data.
 */
async function buildHints(): Promise<Partial<Record<ProviderId, string>>> {
  const hints: Partial<Record<ProviderId, string>> = {};
  if (lastStored.includes("qwen") && lastSnapshot.results.qwen === undefined) {
    if (qwenQuarantine) {
      hints.qwen = "QWEN PAUSED (AUTOTEST)";
    } else if (browserHopBlocked) {
      hints.qwen = "SIGN IN TO QWEN CONSOLE (TRAY)";
    } else if (clock.now() < qwenBackoffUntil) {
      const minutes = Math.ceil((qwenBackoffUntil - clock.now()) / 60_000);
      hints.qwen = `QUOTA PAUSED — RETRY IN ${minutes}m`;
    } else {
      const probe = gatewayProbe.last;
      if (probe === null || probe.via !== "browser") {
        hints.qwen = "CONNECTING TO GATEWAY…";
      } else {
        hints.qwen = "NO DATA THIS TICK";
      }
    }
  }
  return hints;
}

async function tick(): Promise<void> {
  try {
    // Backoff skip rule (WU-Q): pause dispatches ONLY once the browser-hop
    // itself was blocked — warm-up fallback failures never count, so the
    // real Chromium hop always gets its fair attempt once the agent loads.
    const qwenPaused =
      qwenQuarantine || (clock.now() < qwenBackoffUntil && browserHopBlocked);
    const outcome = await runDesktopRefreshTick({
      prefs,
      secrets,
      transport,
      clock,
      qwenDisabled: qwenPaused,
    });
    await refreshLayout();
    lastSnapshot = outcome.snapshot;
    lastStored = await storedProviders();
    lastVisibleCount = visibleCount(lastSnapshot, lastStored);
    lastHints = await buildHints();
    await prefs.remove(LAST_TICK_ERROR_KEY).catch(() => {});
    // Post-incident backoff (WU-Q attribution fix): ONLY a browser-hop block
    // escalates the pause — plain-hop failures are expected while the agent
    // webview warms up. A browser-verified WAF block means the gateway wants
    // a console session: pause long and point the user at the console.
    const qwenStoredNow = lastStored.includes("qwen");
    const qwenEntry = outcome.snapshot.results.qwen;
    const probe = gatewayProbe.last;
    const probeSaysBlocked = probe?.contentType.startsWith("text/html") === true;
    if (qwenEntry?.status === "ok") {
      qwenFailures = 0;
      qwenBackoffUntil = 0;
      browserHopBlocked = false;
    } else if (probeSaysBlocked && probe?.via === "browser") {
      browserHopBlocked = true;
      qwenFailures += 1;
      const pause = Math.min(QWEN_BACKOFF_BASE_MS * 2 ** (qwenFailures - 1), QWEN_BACKOFF_MAX_MS);
      qwenBackoffUntil = clock.now() + pause;
      console.error(`[quotadeck-desktop] qwen browser-hop blocked; paused ${pause / 60_000} min`);
    }
    // Render ALWAYS (even while Keys is open): a key saved inside Keys must
    // be on the strip the moment the user returns — the reported ghost-card
    // bug was a stale innerHTML from a keys-mode tick.
    renderBar();
    if (mode === "bar") {
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
// WU-Q: opening the Qwen console lifts the backoff — a fresh session earns
// an immediate retry.
void listen("quotadeck://qwen-session", () => {
  qwenBackoffUntil = 0;
  browserHopBlocked = false;
  qwenFailures = 0;
  void runQwenCookieProbe("console-open");
  void tick();
});

// Delegated wiring: survives bar re-renders (innerHTML swaps the segments).
bar?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>("#refresh-btn");
  if (button !== null && !demoMode && !button.disabled) {
    // Server-friendly cooldown (post-incident rule): no manual bursts —
    // refresh clicks stay at least 10s apart, matching the extension cadence.
    if (Date.now() - lastRefreshAt < 10_000) {
      return;
    }
    lastRefreshAt = Date.now();
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
  // Post-incident quarantine: the autotest NEVER dispatches qwen hops with
  // production credentials — the Chrome extension shares this account.
  qwenQuarantine = true;
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

  // Ghost-card regression (user report): a key saved while Keys is open must
  // be on the strip the moment it returns — no reorder nudge required.
  showKeys();
  await tick();
  document.getElementById("keys-close")?.click();
  await sleep(600);
  const renderedSegments = bar?.querySelectorAll(".seg:not(.seg-refresh)").length ?? -1;
  report.ghostCard = { stored: lastStored.length, rendered: renderedSegments };

  // Keys growth (user report): with every settings section the window grows
  // so the head — and its ✕ — can never scroll away.
  showKeys();
  await sleep(600);
  report.keysScroll = {
    scroll: keysView?.scrollHeight ?? null,
    client: keysView?.clientHeight ?? null,
  };
  showBar();
  await sleep(400);

  // Tray-icon churn: two consecutive badge writes with the same band must
  // swap the icon at most once (the suspected cause of the vanished icon).
  const statsBefore = await invoke<[number, number]>("tray_stats").catch(() => null);
  (document.getElementById("refresh-btn") as HTMLButtonElement | null)?.click();
  await sleep(2500);
  const statsAfter = await invoke<[number, number]>("tray_stats").catch(() => null);
  report.refresh = { before: statsBefore, after: statsAfter };

  if (lastStored.includes("qwen")) {
    const agent = await invoke<[boolean, string | null]>("qwen_agent_state").catch(() => null);
    report.qwen = {
      agent: agent === null ? "invoke failed" : { exists: agent[0], error: agent[1] },
      gatewayProbe: gatewayProbe.last,
      entry: lastSnapshot.results.qwen ?? null,
    };
  }

  const qwenReport = report.qwen as
    | { agent?: { exists: boolean; error: string | null } }
    | undefined;
  report.verdicts = {
    flipVerticalDOM: computedOf("flipVerticalInBar") === "column",
    flipVerticalWindowMatches: sizeMatches("flipVerticalInBar"),
    flipBackDOM: computedOf("flipBackHorizontal") === "row",
    flipBackWindowMatches: sizeMatches("flipBackHorizontal"),
    keysFlipDOM: computedOf("keysFlipThenClose") === "column",
    keysFlipWindowMatches: sizeMatches("keysFlipThenClose"),
    ghostCardFixed:
      (report.ghostCard as { stored: number; rendered: number }).stored > 0 &&
      (report.ghostCard as { stored: number; rendered: number }).rendered ===
        (report.ghostCard as { stored: number; rendered: number }).stored,
    keysNoScroll:
      (report.keysScroll as { scroll: number; client: number } | undefined) !== undefined &&
      (report.keysScroll as { scroll: number; client: number }).scroll <=
        (report.keysScroll as { scroll: number; client: number }).client + 2,
    refreshReported: statsBefore !== null && statsAfter !== null,
    noIconChurn: statsBefore !== null && statsAfter !== null && statsBefore[1] === statsAfter[1],
    agentWindowCreated: qwenReport?.agent?.exists === true,
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
  // Spike WU-U boot marker: proves THIS exact frontend reached the production
  // path (asset-embed verification — the exe compresses assets, so string
  // scans cannot tell old from new). Removed when the spike closes.
  await prefs.set({ "qd:spike-boot": clock.now() });
  void tick();
  setInterval(() => {
    void tick();
  }, REFRESH_PERIOD_MS);
  // Spike WU-U: one boot probe — the WebView2 profile may already hold a
  // live console session from a previous sign-in.
  void sleep(15_000).then(() => runQwenCookieProbe("boot"));
})();
