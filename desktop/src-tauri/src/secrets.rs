//! Secret persistence: provider key material in the Windows Credential
//! Manager (S5 in odd/tasks/desktop-tray-app.md), desktop counterpart of the
//! extension's `qd:key:{providerId}` invariant.
//!
//! Design: ONE generic credential entry (`quotadeck-desktop` / `secrets`)
//! holds the whole `qd:key:*` map serialized as JSON. Rationale:
//! - Exact StorageArea KV semantics (get/set/remove over arbitrary keys)
//!   without needing a Credential Manager enumeration API.
//! - Atomic reads/writes of the full credential map, matching the extension's
//!   per-cycle read patterns.
//! - One entry keeps total size predictable: the generic credential blob cap
//!   on Windows is small (2560 bytes), and six slots of key material stay an
//!   order of magnitude below it. If provider growth ever nears the cap, the
//!   migration path is per-slot entries or DPAPI-protected file storage.

use std::collections::HashMap;

use keyring::Entry;
use serde_json::Value;

const SERVICE: &str = "quotadeck-desktop";
const USER: &str = "secrets";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USER).map_err(|e| format!("cannot open credential entry: {e}"))
}

#[tauri::command]
pub async fn secrets_read_all() -> Result<HashMap<String, Value>, String> {
    let entry = entry()?;
    match entry.get_password() {
        Ok(blob) => serde_json::from_str(&blob)
            .map_err(|e| format!("corrupt secret blob: {e}")),
        Err(keyring::Error::NoEntry) => Ok(HashMap::new()),
        Err(e) => Err(format!("cannot read secrets: {e}")),
    }
}

#[tauri::command]
pub async fn secrets_write_all(items: HashMap<String, Value>) -> Result<(), String> {
    let entry = entry()?;
    if items.is_empty() {
        // An empty map revokes the entry entirely: no empty secret remains.
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("cannot delete secrets entry: {e}")),
        }
    } else {
        let blob = serde_json::to_string(&items)
            .map_err(|e| format!("cannot serialize secrets: {e}"))?;
        entry
            .set_password(&blob)
            .map_err(|e| format!("cannot write secrets: {e}"))
    }
}
