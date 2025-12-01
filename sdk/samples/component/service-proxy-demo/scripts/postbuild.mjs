import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

function ensureDir(path) {
  try { mkdirSync(path, { recursive: true }); } catch {}
}

const manifestPath = resolve(root, 'manifest.json');
let capabilities = [];
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  capabilities = manifest.capabilities ?? [];
  cpSync(manifestPath, resolve(dist, 'manifest.json'));
  console.log('[postbuild] copied manifest.json to dist/');
}

const uiSrc = resolve(root, 'ui');
if (existsSync(uiSrc)) {
  const uiDest = resolve(dist, 'ui');
  ensureDir(uiDest);
  // Only copy files from ui/ (like index.html), don't overwrite the directory if it exists
  // cpSync will copy files into the destination directory.
  // We want to copy 'ui/*' to 'dist/ui/*'
  cpSync(uiSrc, uiDest, { recursive: true }); 
  console.log('[postbuild] copied ui assets to dist/ui/');
}

const metadata = {
  component: {
    world: 'alga:extension/runner',
    file: 'dist/component.wasm',
  },
  capabilities,
};

ensureDir(dist);
const metadataPath = resolve(dist, 'component.json');
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

const mainWasmPath = resolve(dist, 'main.wasm');
const componentWasmPath = resolve(dist, 'component.wasm');
if (existsSync(componentWasmPath)) {
  cpSync(componentWasmPath, mainWasmPath);
}

console.log('[postbuild] wrote component metadata and main.wasm alias');
