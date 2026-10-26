//! QuotaDeck desktop shell: a tray icon plus a second-taskbar strip.
//!
//! Flyout behavior (S2/S9 in odd/tasks/desktop-tray-app.md):
//! - Left click on the tray icon toggles the strip; it hides on blur so it
//!   behaves like a taskbar-attached popover. The strip has ZERO window
//!   chrome — every control lives in the tray menu.
//! - Right click opens the tray menu: Keys… (taller transient window),
//!   Always on top (pin), Quit.
//! - The strip's bottom-right dock uses the monitor's REAL work area.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent, Wry,
};

mod prefs;
mod secrets;

static PINNED: AtomicBool = AtomicBool::new(false);

/// Small margin from the screen's right edge so the strip border stays
/// visible against the screen border.
const FLYOUT_MARGIN: i32 = 8;

/// KEYS window size — pinned twin of the KEYS constants in main.ts.
const KEYS_WIDTH: f64 = 680.0;
const KEYS_HEIGHT: f64 = 560.0;

/// Managed tray handles: the icon (re-badged per tick via `set_tray_badge`)
/// and the pin check item (its checked state mirrors PINNED). `band` remembers
/// the last applied band so `set_icon` runs ONLY on an actual change —
/// re-setting the icon every tick made Windows Explorer drop the icon from
/// the tray (reported by the user: refresh clicked, icon vanished).
struct TrayState {
    tray: Mutex<TrayIcon>,
    pin: CheckMenuItem<Wry>,
    band: Mutex<String>,
}

/// Instrumentation counters for the autotest harness: every `set_tray_badge`
/// call vs the subset that actually swapped the icon.
static BADGE_CALLS: AtomicUsize = AtomicUsize::new(0);
static ICON_SETS: AtomicUsize = AtomicUsize::new(0);

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
/// user-reported scenarios (orientation flips, refresh, Qwen probe) and
/// writes a self-check report to prefs — see scripts/autotest-desktop.ps1.
#[tauri::command]
fn is_autotest() -> bool {
    std::env::var("QUOTADECK_AUTOTEST").as_deref() == Ok("1")
}

/// Live INNER size (physical px) of the flyout — the autotest asserts the
/// content area matches the layout geometry (outer_size would carry the DWM
/// invisible borders).
#[tauri::command]
fn flyout_size(app: tauri::AppHandle) -> Option<(u32, u32)> {
    let window = app.get_webview_window("flyout")?;
    let size = window.inner_size().ok()?;
    Some((size.width, size.height))
}

/// (badge calls, actual icon sets) — proves the only-on-change policy.
#[tauri::command]
fn tray_stats() -> (usize, usize) {
    (
        BADGE_CALLS.load(Ordering::SeqCst),
        ICON_SETS.load(Ordering::SeqCst),
    )
}

/// Cookie COUNTS (never values) visible to the gateway/console domains from
/// the Qwen sign-in window — autotest measurement for the cross-domain
/// suspicion behind the silent Qwen failure.
#[tauri::command]
fn qwen_cookie_counts(app: tauri::AppHandle) -> (usize, usize) {
    let Some(webview) = app.get_webview_window("qwen-login") else {
        return (0, 0);
    };
    let console = tauri::Url::parse(QWEN_CONSOLE_URL)
        .ok()
        .and_then(|url| webview.cookies_for_url(url).ok())
        .map_or(0, |cookies| cookies.len());
    let gateway = tauri::Url::parse(QWEN_GATEWAY_ORIGIN)
        .ok()
        .and_then(|url| webview.cookies_for_url(url).ok())
        .map_or(0, |cookies| cookies.len());
    (console, gateway)
}

/// Qwen embedded sign-in (WU-K): the token-plan gateway WAF blocks non-browser
/// clients, while the Chrome extension rides the real browser stack WITH the
/// user's console session cookies. The desktop counterpart: open the real
/// Alibaba console in a normal webview window, let the user sign in there,
/// and read that window's cookie jar (HTTP-only included) for the gateway
/// domain on every request. Cookies live ONLY in the webview's store — never
/// persisted to prefs, never returned to the strip, never logged.
const QWEN_CONSOLE_URL: &str = "https://modelstudio.console.alibabacloud.com";
const QWEN_GATEWAY_ORIGIN: &str = "https://token-plan.ap-southeast-1.maas.aliyuncs.com";

fn spawn_qwen_login(app: &tauri::AppHandle) {
    if let Some(existing) = app.get_webview_window("qwen-login") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let Ok(url) = QWEN_CONSOLE_URL.parse() else {
        return;
    };
    let _window = tauri::WebviewWindowBuilder::new(
        app,
        "qwen-login",
        tauri::WebviewUrl::External(url),
    )
    .title("Qwen Console — sign in")
    .inner_size(980.0, 760.0)
    .build();
}

#[tauri::command]
fn open_qwen_login(app: tauri::AppHandle) {
    spawn_qwen_login(&app);
}

/// The gateway Cookie header assembled from the login window's jar, or None
/// when no sign-in window exists (user must sign in via the tray menu).
#[tauri::command]
fn qwen_gateway_cookies(app: tauri::AppHandle) -> Option<String> {
    let webview = app.get_webview_window("qwen-login")?;
    let url = tauri::Url::parse(QWEN_GATEWAY_ORIGIN).ok()?;
    let cookies = webview.cookies_for_url(url).ok()?;
    let header = cookies
        .iter()
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
        .collect::<Vec<_>>()
        .join("; ");
    if header.is_empty() {
        None
    } else {
        Some(header)
    }
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
/// edge against the taskbar — via the monitor's REAL work area (S9), never a
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
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
            let window = app
                .get_webview_window("flyout")
                .expect("flyout window must exist in tauri.conf.json");
            anchor_flyout(&window);

            let keys_item = MenuItem::with_id(app, "keys", "Keys…", true, None::<&str>)?;
            let qwen_login_item =
                MenuItem::with_id(app, "qwen_login", "Qwen sign-in…", true, None::<&str>)?;
            let pin_item =
                CheckMenuItem::with_id(app, "pin", "Always on top", true, false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit QuotaDeck", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&keys_item, &qwen_login_item, &pin_item, &quit])?;

            let tray = TrayIconBuilder::with_id("quotadeck-tray")
                .icon(app.default_window_icon().expect("bundle icon").clone())
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
                    "qwen_login" => spawn_qwen_login(app),
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
                band: Mutex::new(String::from("__bundle")),
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // The sign-in window keeps its cookie jar alive: closing it only
            // hides it — destroyed windows lose the session cookies and the
            // gateway falls back to the WAF block page.
            if window.label() == "qwen-login" {
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
            qwen_cookie_counts,
            open_qwen_login,
            qwen_gateway_cookies,
            prefs::prefs_read_all,
            prefs::prefs_write_all,
            secrets::secrets_read_all,
            secrets::secrets_write_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running QuotaDeck desktop");
}
