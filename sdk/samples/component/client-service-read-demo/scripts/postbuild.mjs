import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const root = resolve(__dirname, '..')
const dist = resolve(root, 'dist')

function ensureDir(path) {
  try {
    mkdirSync(path, { recursive: true })
  } catch {}
}

ensureDir(dist)

const manifestPath = resolve(root, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const capabilities = manifest.capabilities ?? []

cpSync(manifestPath, resolve(dist, 'manifest.json'))

const metadata = {
  component: {
    world: 'alga:extension/runner',
    file: 'dist/component.wasm',
  },
  capabilities,
}

writeFileSync(resolve(dist, 'component.json'), JSON.stringify(metadata, null, 2), 'utf8')

const componentWasmPath = resolve(dist, 'component.wasm')
if (existsSync(componentWasmPath)) {
  cpSync(componentWasmPath, resolve(dist, 'main.wasm'))
}

console.log('[postbuild] wrote dist/main.wasm, dist/component.json, and dist/manifest.json')
