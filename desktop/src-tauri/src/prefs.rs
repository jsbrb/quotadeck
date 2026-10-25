//! Non-secret preferences persistence: a single JSON document in the OS app
//! data directory (`%APPDATA%/quotadeck-desktop/prefs.json`).
//!
//! Desktop counterpart of the extension's `chrome.storage.local` for
//! everything that is NOT key material: the cycle snapshot (`qd:snapshot`)
//! and non-secret preferences (`qd:pref:*`). Secrets never reach this file —
//! they live in `secrets.rs` (Windows Credential Manager), mirroring the
//! extension invariant that `qd:key:{id}` is the only home for key material.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

const PREFS_FILE: &str = "prefs.json";

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    Ok(dir.join(PREFS_FILE))
}

#[tauri::command]
pub async fn prefs_read_all(app: AppHandle) -> Result<HashMap<String, Value>, String> {
    let path = prefs_path(&app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("cannot read prefs: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("corrupt prefs document: {e}"))
}

#[tauri::command]
pub async fn prefs_write_all(
    app: AppHandle,
    items: HashMap<String, Value>,
) -> Result<(), String> {
    let path = prefs_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create app data dir: {e}"))?;
    }
    let serialized =
        serde_json::to_string_pretty(&items).map_err(|e| format!("cannot serialize prefs: {e}"))?;
    fs::write(&path, serialized).map_err(|e| format!("cannot write prefs: {e}"))
}
