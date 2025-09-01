import { mkdirSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('[build] done');
