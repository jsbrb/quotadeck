// Desktop StorageArea adapters — the platform seam for the desktop app
// (mirrors the extension's platform/browser-api.ts role).
//
// The extension's stores (KeyStore, SnapshotStore, preference stores) take an
// injected `StorageArea` (the promise-based MV3 port declared in
// extension/src/storage/key-store.ts). The desktop app reuses those stores
// unchanged (S4) and provides two concrete areas behind the same port:
//
// - prefs area (`createPrefsArea`): non-secret data (`qd:snapshot`,
//   `qd:pref:*`) persisted as one JSON document in the OS app data directory.
// - secrets area (`createSecretsArea`): key material (`qd:key:*`) persisted
//   in the Windows Credential Manager (src-tauri/src/secrets.rs) — the only
//   home for credentials on desktop, mirroring the extension invariant.
//
// Both areas keep full-KV semantics with a lazy in-memory cache and
// write-through persistence of the whole map (the Rust side owns the real
// storage document/entry).

import { invoke } from "@tauri-apps/api/core";
import type { StorageArea } from "@shared/storage/key-store";

/** Full-map payload shape accepted by both Rust persistence commands. */
type StorageMap = Record<string, unknown>;

class RpcArea implements StorageArea {
  private cache: Promise<Map<string, unknown>> | null = null;

  constructor(
    private readonly readCommand: string,
    private readonly writeCommand: string,
  ) {}

  private load(): Promise<Map<string, unknown>> {
    if (this.cache === null) {
      this.cache = invoke<StorageMap>(this.readCommand).then((items) =>
        new Map(Object.entries(items ?? {})),
      );
    }
    return this.cache;
  }

  private persist(map: Map<string, unknown>): Promise<void> {
    const items = Object.fromEntries(map);
    return invoke(this.writeCommand, { items });
  }

  async get(keys: string | string[] | null): Promise<StorageMap> {
    const map = await this.load();
    const requested =
      keys === null ? [...map.keys()] : Array.isArray(keys) ? keys : [keys];
    const found: StorageMap = {};
    for (const key of requested) {
      const value = map.get(key);
      if (value !== undefined) {
        found[key] = value;
      }
    }
    return found;
  }

  async set(items: StorageMap): Promise<void> {
    const map = await this.load();
    for (const [key, value] of Object.entries(items)) {
      map.set(key, value);
    }
    await this.persist(map);
  }

  async remove(keys: string | string[]): Promise<void> {
    const map = await this.load();
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      map.delete(key);
    }
    await this.persist(map);
  }
}

/** Non-secret storage (`qd:snapshot`, `qd:pref:*`): JSON file in app data. */
export function createPrefsArea(): StorageArea {
  return new RpcArea("prefs_read_all", "prefs_write_all");
}

/** Secret storage (`qd:key:*`): Windows Credential Manager entry. */
export function createSecretsArea(): StorageArea {
  return new RpcArea("secrets_read_all", "secrets_write_all");
}
