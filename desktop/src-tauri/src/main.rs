//! QuotaDeck desktop shell: a tray icon plus a second-taskbar strip.
//!
//! Flyout behavior (S2/S9 in odd/tasks/desktop-tray-app.md):
//! - Left click on the tray icon toggles the strip; it hides on blur so it
//!   behaves like a taskbar-attached popover. The strip has ZERO window
//!   chrome — every control lives in the tray menu.
//! - Right click opens the tray menu: Keys… (taller transient window),
//!   Always on top (pin), Quit.
//! - The strip's bottom-right dock uses the monitor's REAL work area.

use std::sync::atomic::{AtomicBool, Ordering};
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
/// and the pin check item (its checked state mirrors PINNED).
struct TrayState {
    tray: Mutex<TrayIcon>,
    pin: CheckMenuItem<Wry>,
}

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
    let state = app.state::<TrayState>();
    let tray = state.tray.lock().unwrap();
    let _ = tray.set_icon(Some(band_icon(&band)));
    let _ = tray.set_tooltip(Some(tooltip.as_str()));
}

/// Demo mode flag for layout previews: `QUOTADECK_DEMO=1` makes the frontend
/// render the seeded snapshot and skip ticks entirely.
#[tauri::command]
fn is_demo() -> bool {
    std::env::var("QUOTADECK_DEMO").as_deref() == Ok("1")
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
            let pin_item =
                CheckMenuItem::with_id(app, "pin", "Always on top", true, false, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit QuotaDeck", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&keys_item, &pin_item, &quit])?;

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
            });

            Ok(())
        })
        .on_window_event(|window, event| {
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
            prefs::prefs_read_all,
            prefs::prefs_write_all,
            secrets::secrets_read_all,
            secrets::secrets_write_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running QuotaDeck desktop");
}
