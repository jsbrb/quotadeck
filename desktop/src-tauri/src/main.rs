//! QuotaDeck desktop shell: a tray icon plus a frameless flyout window.
//!
//! Flyout behavior (S2 in odd/tasks/desktop-tray-app.md):
//! - Left click on the tray icon toggles the flyout; it hides on blur so it
//!   behaves like a menubar popover.
//! - The PIN toggle (frontend -> `set_pinned`) keeps the window always on top
//!   and exempt from the hide-on-blur rule: the "mini window" surface.
//! - Right click opens the tray menu with Quit.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

mod prefs;
mod secrets;

static PINNED: AtomicBool = AtomicBool::new(false);

/// Estimated taskbar height used to anchor the flyout above it. Refined in
/// WU-D when the flyout anchors to the real tray icon position.
const TASKBAR_ESTIMATE: i32 = 48;
const FLYOUT_MARGIN: i32 = 12;

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
    let screen = monitor.size();
    let win = window.outer_size().unwrap_or_default();
    let x = (screen.width as i32 - win.width as i32 - FLYOUT_MARGIN).max(0);
    let y = (screen.height as i32 - win.height as i32 - TASKBAR_ESTIMATE).max(0);
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
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

            let _tray = TrayIconBuilder::with_id("quotadeck-tray")
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
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                anchor_flyout(&window);
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app.handle())?;

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
            prefs::prefs_read_all,
            prefs::prefs_write_all,
            secrets::secrets_read_all,
            secrets::secrets_write_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running QuotaDeck desktop");
}
