// Build script: esbuild bundles the service-worker entry to dist/background.js
// and the popup entry to dist/popup.js (IIFE each, no code splitting for MV3),
// then copies the manifest and the static popup shell next to them.
// esbuild emits JS; type checking is a separate `npm run typecheck` (tsc --noEmit).
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const outDir = 'dist';

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: ['src/background.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outfile: `${outDir}/background.js`,
  // Keep the bundle readable for review; the fixture-only worker is tiny.
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});

// Popup entry (AD-14): same flags as the worker; the popup imports only its
// own code plus core/providers (pure), so nothing here needs special handling.
await build({
  entryPoints: ['src/popup/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outfile: `${outDir}/popup.js`,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});

await cp('public/manifest.json', `${outDir}/manifest.json`);
await cp('public/popup.html', `${outDir}/popup.html`);
await cp('public/icons', `${outDir}/icons`, { recursive: true });

console.log(`built ${outDir}/background.js + ${outDir}/popup.js + ${outDir}/manifest.json + ${outDir}/popup.html + ${outDir}/icons/`);
