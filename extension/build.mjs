// Build script: esbuild bundles the single service-worker entry to dist/background.js
// (IIFE, no code splitting for MV3 workers) and copies the manifest next to it.
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

await cp('public/manifest.json', `${outDir}/manifest.json`);

console.log(`built ${outDir}/background.js + ${outDir}/manifest.json`);
