//! QuotaDeck desktop shell: a tray icon plus a frameless flyout window.
//!
//! Flyout behavior (S2 in odd/tasks/desktop-tray-app.md):
//! - Left click on the tray icon toggles the flyout; it hides on blur so it
//!   behaves like a menubar popover.
//! - The PIN toggle (frontend -> `set_pinned`) keeps the window always on top
//!   and exempt from the hide-on-blur rule: the "mini window" surface.
//! - Right click opens the tray menu with Quit.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

mod prefs;
mod secrets;

static PINNED: AtomicBool = AtomicBool::new(false);

/// Managed handle to the tray icon so commands can re-badge it. The icon IS
/// the desktop badge: band color per the chosen provider's threshold (WU-E),
/// swapped by the frontend after every tick via `set_tray_badge`.
struct TrayState {
    tray: Mutex<TrayIcon>,
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

/// Small margin from the screen's right edge so the strip border stays
/// visible against the screen border.
const FLYOUT_MARGIN: i32 = 8;

#[tauri::command]
fn set_pinned(app: tauri::AppHandle, pinned: bool) {
    PINNED.store(pinned, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("flyout") {
        let _ = window.set_always_on_top(pinned);
        if pinned {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch surfaces the existing flyout instead of forking
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

            let quit = MenuItem::with_id(app, "quit", "Quit QuotaDeck", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            let tray = TrayIconBuilder::with_id("quotadeck-tray")
                .icon(app.default_window_icon().expect("bundle icon").clone())
                .tooltip("QuotaDeck")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("flyout") {
                            // Fixed dock (S9): the strip always shows at the
                            // bottom-right, regardless of which tray slot the
                            // icon sits in.
                            anchor_flyout(&window);
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app.handle())?;
            app.manage(TrayState {
                tray: Mutex::new(tray),
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
            set_pinned,
            set_tray_badge,
            reflow_flyout,
            prefs::prefs_read_all,
            prefs::prefs_write_all,
            secrets::secrets_read_all,
            secrets::secrets_write_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running QuotaDeck desktop");
}
