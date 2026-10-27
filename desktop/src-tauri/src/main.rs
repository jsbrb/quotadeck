// Prevents an extra console window on Windows in release builds. In dev
// builds (debug_assertions) the console stays so logs remain visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! QuotaDeck desktop shell: a tray icon plus a second-taskbar strip.
//!
//! Flyout behavior (S2/S9 in odd/tasks/desktop-tray-app.md):
//! - Left click on the tray icon toggles the strip; it hides on blur so it
//!   behaves like a taskbar-attached popover. The strip has ZERO window
//!   chrome - every control lives in the tray menu.
//! - Right click opens the tray menu: Keys..., Qwen console..., Always on
//!   top (pin), Quit.
//! - The strip's bottom-right dock uses the monitor's REAL work area.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent, Wry,
};
use tauri_plugin_autostart::{ManagerExt as AutostartManagerExt, MacosLauncher};

mod prefs;
mod secrets;

static PINNED: AtomicBool = AtomicBool::new(false);

/// Small margin from the screen's right edge so the strip border stays
/// visible against the screen border.
const FLYOUT_MARGIN: i32 = 8;

/// KEYS window size - pinned twin of the KEYS constants in main.ts.
const KEYS_WIDTH: f64 = 680.0;
const KEYS_HEIGHT: f64 = 560.0;

/// Qwen browser-hop (WU-P/WU-Q): the token-plan gateway WAF fingerprints the
/// client and blocks reqwest with a 200 HTML block page, while the Chrome
/// extension works because its requests ARE browser requests. The desktop
/// parity fix: a HIDDEN webview loaded on the console origin; the gateway
/// hop is executed INSIDE that real Chromium (fetch with the page's own
/// Origin - the same shape the extension's DNR rule produced) and the JSON
/// response travels back through the page title (evaluate_script has no
/// return channel to Rust). `--disable-web-security` lets the page read the
/// cross-origin gateway response; this webview only ever loads the
/// ALIBABA console URL, and the Bearer rides only as a fetch argument.
const QWEN_CONSOLE_URL: &str = "https://modelstudio.console.alibabacloud.com";
/// Hard allowlist of the origins this hop may ever talk to: the mint host,
/// the quota gateway (the extension's hop-2 host), and the legacy token-plan
/// origin (kept so older cached flows still route through the hop).
const QWEN_GATEWAY_ORIGINS: [&str; 3] = [
    "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    "https://bailian-singapore-cs.alibabacloud.com",
    "https://modelstudio.ap-southeast-1.aliyuncs.com",
];
const QWEN_AGENT_LABEL: &str = "qwen-agent";

/// Managed tray handles: the icon (re-badged per tick via `set_tray_badge`)
/// and the pin check item (its checked state mirrors PINNED). `band`
/// remembers the last applied band so `set_icon` runs ONLY on an actual
/// change - re-setting the icon every tick made Windows Explorer drop the
/// icon from the tray (reported by the user: refresh clicked, icon vanished).
struct TrayState {
    tray: Mutex<TrayIcon>,
    pin: CheckMenuItem<Wry>,
    autostart_item: CheckMenuItem<Wry>,
    band: Mutex<String>,
}

/// Instrumentation counters for the autotest harness: every `set_tray_badge`
/// call vs the subset that actually swapped the icon.
static BADGE_CALLS: AtomicUsize = AtomicUsize::new(0);
static ICON_SETS: AtomicUsize = AtomicUsize::new(0);

/// Last agent-creation failure (WU-R): surfaced through `qwen_agent_state`
/// so a silent creation failure can never hide again.
static AGENT_LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);
/// One startup-time creation attempt only - runtime re-creation deadlocks.
static AGENT_CREATION_ATTEMPTED: AtomicBool = AtomicBool::new(false);

fn band_icon(band: &str) -> Image<'static> {
    match band {
        "orange" => tauri::include_image!("icons/tray/orange.png"),
        "deep" => tauri::include_image!("icons/tray/deep.png"),
        "red" => tauri::include_image!("icons/tray/red.png"),
        _ => tauri::include_image!("icons/tray/neutral.png"),
    }
}

#[tauri::command]
fn set_tray_badge(app: tauri::AppHandle, band: String, tooltip: String) {
    BADGE_CALLS.fetch_add(1, Ordering::SeqCst);
    let state = app.state::<TrayState>();
    {
        let mut current = state.band.lock().unwrap();
        if *current != band {
            let tray = state.tray.lock().unwrap();
            let _ = tray.set_icon(Some(band_icon(&band)));
            ICON_SETS.fetch_add(1, Ordering::SeqCst);
            *current = band.clone();
        }
    }
    let tray = state.tray.lock().unwrap();
    let _ = tray.set_tooltip(Some(tooltip.as_str()));
}

/// Demo mode flag for layout previews: `QUOTADECK_DEMO=1` makes the frontend
/// render the seeded snapshot and skip ticks entirely.
#[tauri::command]
fn is_demo() -> bool {
    std::env::var("QUOTADECK_DEMO").as_deref() == Ok("1")
}

/// Autotest flag: `QUOTADECK_AUTOTEST=1` drives the strip through the
/// user-reported scenarios and writes a self-check report to prefs - see
/// scripts/autotest-desktop.ps1. Quarantine: the autotest NEVER dispatches
/// qwen hops with production credentials.
#[tauri::command]
fn is_autotest() -> bool {
    std::env::var("QUOTADECK_AUTOTEST").as_deref() == Ok("1")
}

/// Live INNER size (physical px) of the flyout - the autotest asserts the
/// content area matches the layout geometry (outer_size would carry the DWM
/// invisible borders).
#[tauri::command]
fn flyout_size(app: tauri::AppHandle) -> Option<(u32, u32)> {
    let window = app.get_webview_window("flyout")?;
    let size = window.inner_size().ok()?;
    Some((size.width, size.height))
}

/// (badge calls, actual icon sets) - proves the only-on-change policy.
#[tauri::command]
fn tray_stats() -> (usize, usize) {
    (
        BADGE_CALLS.load(Ordering::SeqCst),
        ICON_SETS.load(Ordering::SeqCst),
    )
}

/// (exists, last creation error) - autotest verdict source for the agent.
#[tauri::command]
fn qwen_agent_state(app: tauri::AppHandle) -> (bool, Option<String>) {
    if app.get_webview_window(QWEN_AGENT_LABEL).is_some() {
        return (true, None);
    }
    // Not alive right now: attempt a lazy creation so the state is fresh.
    match ensure_qwen_agent(&app) {
        Ok(_) => (true, None),
        Err(e) => (false, Some(e)),
    }
}

fn ensure_qwen_agent(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(QWEN_AGENT_LABEL) {
        *AGENT_LAST_ERROR.lock().unwrap() = None;
        return Ok(existing);
    }
    if AGENT_CREATION_ATTEMPTED.load(Ordering::SeqCst) {
        let cached = AGENT_LAST_ERROR
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| "agent not initialized at startup".to_string());
        return Err(cached);
    }
    AGENT_CREATION_ATTEMPTED.store(true, Ordering::SeqCst);
    let url: tauri::Url = match QWEN_CONSOLE_URL.parse() {
        Ok(url) => url,
        Err(e) => {
            *AGENT_LAST_ERROR.lock().unwrap() = Some(format!("bad console url: {e}"));
            return Err(format!("bad console url: {e}"));
        }
    };
    let built = tauri::WebviewWindowBuilder::new(
        app,
        QWEN_AGENT_LABEL,
        tauri::WebviewUrl::External(url),
    )
    .title("QuotaDeck Qwen agent")
    .inner_size(900.0, 700.0)
    .visible(false)
    // WU-S RESULT: `--disable-web-security` CRASHES WebView2 environment
    // creation even on the FIRST webview - the platform wall stands. The
    // agent boots with the DEFAULT environment (CORS-blocked for gateway
    // reads), so the browser-hop stays dormant and the qwen % remains a
    // Chrome-extension-only surface until a different mechanism is found.
    .build();
    match built {
        Ok(window) => {
            *AGENT_LAST_ERROR.lock().unwrap() = None;
            Ok(window)
        }
        Err(e) => {
            let message = format!("agent window build failed: {e}");
            *AGENT_LAST_ERROR.lock().unwrap() = Some(message.clone());
            Err(message)
        }
    }
}

/// Shows the agent window (tray "Qwen console..." - manual inspection/login).
/// Opening it also lifts the qwen backoff via an event: a fresh console with
/// a signed-in session deserves an immediate retry.
#[tauri::command]
fn open_qwen_login(app: tauri::AppHandle) {
    match ensure_qwen_agent(&app) {
        Ok(window) => {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit_to("flyout", "quotadeck://qwen-session", ());
        }
        Err(_) => {}
    }
}

fn qwen_agent_eval(app: &tauri::AppHandle, script: &str) -> Option<String> {
    let webview = ensure_qwen_agent(app).ok()?;
    webview.eval(script).ok()?;
    // The script answers through document.title ("QDR:" prefix); poll for it.
    for _ in 0..48 {
        std::thread::sleep(std::time::Duration::from_millis(250));
        if let Ok(title) = webview.title() {
            if let Some(rest) = title.strip_prefix("QDR:") {
                let _ = webview.eval("document.title='QuotaDeck Qwen agent';");
                return Some(rest.to_string());
            }
        }
    }
    None
}

fn qwen_agent_origin(app: &tauri::AppHandle) -> Option<String> {
    let webview = ensure_qwen_agent(app).ok()?;
    let _ = webview.eval("document.title='QDR:'+JSON.stringify(String(location.origin));");
    for _ in 0..48 {
        std::thread::sleep(std::time::Duration::from_millis(250));
        if let Ok(title) = webview.title() {
            if let Some(rest) = title.strip_prefix("QDR:") {
                let _ = webview.eval("document.title='QuotaDeck Qwen agent';");
                return Some(rest.trim_matches('"').to_string());
            }
        }
    }
    None
}

/// Runs the gateway fetch INSIDE the agent webview (real Chromium TLS + the
/// console Origin). Returns (status, content-type, body-text). Warm-up: while
/// the console page has not reached the console origin yet, answers None and
/// the caller falls back to the plain transport for this tick.
#[tauri::command]
fn qwen_gateway_fetch(
    app: tauri::AppHandle,
    url: String,
    method: String,
    authorization: Option<String>,
    body: Option<String>,
    content_type: Option<String>,
) -> Option<(u16, String, String)> {
    // Spike WU-U (cookie-hop): an ABSENT (or empty) authorization switches the
    // hop to SESSION-COOKIE auth — no Authorization header at all (a custom
    // header would force a CORS preflight and require an explicit allow) plus
    // `credentials: "include"` so the console session cookies ride along. This
    // mirrors how the console web app itself reads quotas.
    let bearer = authorization.filter(|value| !value.is_empty());
    if !QWEN_GATEWAY_ORIGINS.iter().any(|origin| url.starts_with(origin)) {
        return None; // hard allowlist: this hop only ever talks to the gateways
    }
    // Wait for the agent page to sit on the console origin (first load can
    // take a while; the caller falls back to the plain hop meanwhile).
    for _ in 0..4 {
        if let Some(origin) = qwen_agent_origin(&app) {
            if origin == QWEN_CONSOLE_URL {
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    let auth_json = serde_json::to_string(&bearer).ok()?;
    let body_json = serde_json::to_string(&body).ok()?;
    let content_type =
        content_type.unwrap_or_else(|| "application/json".to_string());
    let ct_json = serde_json::to_string(&content_type).ok()?;
    let headers_json = match &bearer {
        Some(_) => format!(r#"{{ "Authorization": {auth_json}, "Content-Type": {ct_json} }}"#),
        None => format!(r#"{{ "Content-Type": {ct_json} }}"#),
    };
    let credentials_json = if bearer.is_some() { "omit" } else { "include" };
    let script = format!(
        r#"(async () => {{
            try {{
                const r = await fetch({url}, {{
                    method: {method},
                    headers: {headers},
                    credentials: {credentials},
                    body: {body}
                }});
                const t = await r.text();
                const ct = r.headers.get("content-type") || "?";
                document.title = "QDR:" + JSON.stringify({{ s: r.status, c: ct, b: t.slice(0, 60000) }});
            }} catch (e) {{
                document.title = "QDR:" + JSON.stringify({{ s: 0, c: "error", b: String(e) }});
            }}
        }})();"#,
        url = serde_json::to_string(&url).ok()?,
        method = serde_json::to_string(&method).ok()?,
        headers = headers_json,
        credentials = credentials_json,
        body = body_json,
    );
    let answer = qwen_agent_eval(&app, &script)?;
    let value: serde_json::Value = serde_json::from_str(&answer).ok()?;
    Some((
        value.get("s")?.as_u64()? as u16,
        value.get("c")?.as_str()?.to_string(),
        value.get("b")?.as_str()?.to_string(),
    ))
}

/// Resizes the flyout (logical px from the frontend's deterministic strip
/// math) and re-docks it in the same step, so growth never displaces the
/// bottom-right anchor.
#[tauri::command]
fn reflow_flyout(app: tauri::AppHandle, width: f64, height: f64) {
    if let Some(window) = app.get_webview_window("flyout") {
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
        anchor_flyout(&window);
    }
}

/// Docks the flyout bottom-right: right edge against the screen side, bottom
/// edge against the taskbar - via the monitor's REAL work area (S9), never a
/// taskbar estimate.
fn anchor_flyout(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let area = monitor.work_area();
    let win = window.outer_size().unwrap_or_default();
    let right = area.position.x + area.size.width as i32;
    let bottom = area.position.y + area.size.height as i32;
    let x = (right - FLYOUT_MARGIN - win.width as i32).max(area.position.x);
    let y = (bottom - win.height as i32).max(area.position.y);
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Monitor work area (physical px) - the KEYS window grows to its content
/// capped by this.
#[tauri::command]
fn work_area_size(app: tauri::AppHandle) -> Option<(u32, u32)> {
    let window = app.get_webview_window("flyout")?;
    let monitor = window.current_monitor().ok()??;
    let area = monitor.work_area();
    Some((area.size.width, area.size.height))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch surfaces the existing strip instead of forking
            // a duplicate tray app.
            if let Some(window) = app.get_webview_window("flyout") {
                anchor_flyout(&window);
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            // WU-S spike: the Qwen agent is the FIRST webview so the WebView2
            // environment forms ONCE with --disable-web-security (creating a
            // second webview with different args crashed; creating any webview
            // at runtime deadlocked). The flyout inherits the same environment.
            match ensure_qwen_agent(app.handle()) {
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[quotadeck-desktop] qwen agent unavailable: {e}");
                }
            }

            let flyout = tauri::WebviewWindowBuilder::new(
                app,
                "flyout",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("QuotaDeck")
            .inner_size(700.0, 48.0)
            .resizable(false)
            .decorations(false)
            .skip_taskbar(true)
            .visible(false)
            .build()?;
            anchor_flyout(&flyout);

            let keys_item = MenuItem::with_id(app, "keys", "Keys...", true, None::<&str>)?;
            let qwen_login_item =
                MenuItem::with_id(app, "qwen_login", "Qwen console...", true, None::<&str>)?;
            let autostart_manager = app.autolaunch();
            let autostart_enabled = autostart_manager.is_enabled().unwrap_or(false);
            let autostart_item = CheckMenuItem::with_id(
                app,
                "autostart",
                "Start with Windows",
                true,
                autostart_enabled,
                None::<&str>,
            )?;
            let pin_item =
                CheckMenuItem::with_id(app, "pin", "Always on top", true, false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit QuotaDeck", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&keys_item, &qwen_login_item, &autostart_item, &pin_item, &quit],
            )?;

            let tray = TrayIconBuilder::with_id("quotadeck-tray")
                // Blue Q from the start (the bundle logo is paper-colored and
                // reads as a white blob on the dark tray); the first tick
                // re-badges it with the threshold band.
                .icon(tauri::include_image!("icons/tray/neutral.png"))
                .tooltip("QuotaDeck")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "keys" => {
                        if let Some(window) = app.get_webview_window("flyout") {
                            let _ =
                                window.set_size(tauri::LogicalSize::new(KEYS_WIDTH, KEYS_HEIGHT));
                            anchor_flyout(&window);
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit_to("flyout", "quotadeck://show-keys", ());
                        }
                    }
                    "qwen_login" => open_qwen_login(app.clone()),
                    "autostart" => {
                        let manager = app.autolaunch();
                        let enabled = manager.is_enabled().unwrap_or(false);
                        let _ = if enabled {
                            manager.disable()
                        } else {
                            manager.enable()
                        };
                        let state = app.state::<TrayState>();
                        let _ = state.autostart_item.set_checked(!enabled);
                    }
                    "pin" => {
                        let pinned = !PINNED.load(Ordering::SeqCst);
                        PINNED.store(pinned, Ordering::SeqCst);
                        let state = app.state::<TrayState>();
                        let _ = state.pin.set_checked(pinned);
                        if let Some(window) = app.get_webview_window("flyout") {
                            let _ = window.set_always_on_top(pinned);
                            if pinned {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        // Fixed dock (S9): the strip always shows at the
                        // bottom-right, regardless of the icon's tray slot.
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("flyout") {
                            anchor_flyout(&window);
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit_to("flyout", "quotadeck://show-bar", ());
                        }
                    }
                })
                .build(app.handle())?;
            app.manage(TrayState {
                tray: Mutex::new(tray),
                pin: pin_item,
                autostart_item: autostart_item,
                band: Mutex::new(String::from("__bundle")),
            });

            // Qwen agent (WU-P/WU-Q): created HERE on the main thread at
            // startup - runtime creation of a second webview with different
            // browser args deadlocks the event loop (WU-Q hang).
            ensure_qwen_agent(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // The Qwen agent keeps its browser context alive: closing it only
            // hides it - a destroyed webview loses the console session.
            if window.label() == QWEN_AGENT_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            if matches!(event, WindowEvent::Focused(false)) && window.label() == "flyout" {
                if !PINNED.load(Ordering::SeqCst) {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_tray_badge,
            reflow_flyout,
            is_demo,
            is_autotest,
            flyout_size,
            tray_stats,
            qwen_agent_state,
            qwen_gateway_fetch,
            work_area_size,
            open_qwen_login,
            prefs::prefs_read_all,
            prefs::prefs_write_all,
            secrets::secrets_read_all,
            secrets::secrets_write_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running QuotaDeck desktop");
}
