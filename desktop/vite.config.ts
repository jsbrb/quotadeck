import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The desktop flyout reuses the extension's browser-free core (providers,
// refresh engine, error taxonomy) straight from the sibling extension source
// tree via the @shared alias. This branch never edits files under extension/.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../extension/src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
});
