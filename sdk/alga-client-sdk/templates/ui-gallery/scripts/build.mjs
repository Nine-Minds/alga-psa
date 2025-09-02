import { mkdirSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

function ensureDir(p) { try { mkdirSync(p, { recursive: true }); } catch {} }

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

ensureDir(dist);

// Copy manifest.json into dist for preview flows
const manifestSrc = resolve(root, 'manifest.json');
if (existsSync(manifestSrc)) {
  const manifestDest = resolve(dist, 'manifest.json');
  const json = readFileSync(manifestSrc, 'utf8');
  writeFileSync(manifestDest, json, 'utf8');
  console.log(`[build] wrote: ${manifestDest}`);
}

// Copy UI assets to dist/ui for simple static preview hosting
const uiSrc = resolve(root, 'ui');
if (existsSync(uiSrc)) {
  const uiDest = resolve(dist, 'ui');
  cpSync(uiSrc, uiDest, { recursive: true });
  console.log(`[build] copied UI to: ${uiDest}`);
}

// Build React UI gallery using local project deps (@alga-psa/ui-kit from npm)
try {
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [resolve(root, 'src/main.tsx')],
    outfile: resolve(dist, 'ui/index.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    sourcemap: false,
    minify: true,
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js'],
    define: { 'process.env.NODE_ENV': '"production"' }
  });

  // Copy UI Kit tokens CSS via package export resolution
  const require = createRequire(import.meta.url);
  let tokensCss;
  try {
    tokensCss = require.resolve('@alga-psa/ui-kit/theme.css');
  } catch {}
  if (tokensCss && existsSync(tokensCss)) {
    const destCss = resolve(dist, 'ui/theme.css');
    cpSync(tokensCss, destCss);
    console.log(`[build] copied tokens CSS to: ${destCss}`);
  }
} catch (e) {
  console.warn('[build] ui-gallery React build skipped (missing local deps). Run `npm install` first.');
}

console.log('[build] done');
