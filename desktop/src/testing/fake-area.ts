// In-memory StorageArea fake for desktop unit tests — the desktop twin of
// the extension's src/testing FakeStorageArea (same MV3-area semantics).

import type { StorageArea } from "@shared/storage/key-store";

export function fakeArea(initial: Record<string, unknown> = {}): StorageArea {
  const map = new Map(Object.entries(initial));
  return {
    async get(keys) {
      const requested =
        keys === null ? [...map.keys()] : Array.isArray(keys) ? keys : [keys];
      const found: Record<string, unknown> = {};
      for (const key of requested) {
        if (map.has(key)) {
          found[key] = map.get(key);
        }
      }
      return found;
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        map.set(key, value);
      }
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        map.delete(key);
      }
    },
  };
}
