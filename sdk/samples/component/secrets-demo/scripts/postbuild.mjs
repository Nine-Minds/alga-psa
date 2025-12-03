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
