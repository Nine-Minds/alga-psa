import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const serverDir = path.join(repoRoot, 'server');
const nextConfigPath = path.join(serverDir, 'next.config.mjs');

const WORKFLOWS_ENTRY = '@alga-psa/workflows/entry';

async function runWithEnv(env, fn) {
  const original = { ...process.env };
  try {
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(original)) {
      process.env[key] = value;
    }
  }
}

async function loadNextConfigFresh() {
  const href = `${pathToFileURL(nextConfigPath).href}?cachebust=${Date.now()}-${Math.random()}`;
  const mod = await import(href);
  return mod.default;
}

function applyWebpackConfig(nextConfig, envLabel) {
  assert.equal(typeof nextConfig.webpack, 'function', `${envLabel}: next.config.mjs missing webpack() export`);

  const config = {
    resolve: { alias: {}, modules: ['node_modules'], extensionAlias: {}, fallback: {} },
    plugins: [],
    externals: [],
    module: { rules: [] },
    output: { path: path.join(serverDir, '.next'), webassemblyModuleFilename: '' },
  };

  const result = nextConfig.webpack(config, { isServer: true, dev: false });
  return result ?? config;
}

function assertAlias(config, expected, envLabel) {
  const actual = config?.turbopack?.resolveAlias?.[WORKFLOWS_ENTRY];
  assert.equal(
    actual,
    expected,
    `${envLabel}: turbopack.resolveAlias[${WORKFLOWS_ENTRY}] expected ${expected}, got ${actual}`
  );
}

function assertWebpackAlias(webpackConfig, expected, envLabel) {
  const actual = webpackConfig?.resolve?.alias?.[WORKFLOWS_ENTRY];
  assert.equal(
    actual,
    expected,
    `${envLabel}: webpack resolve.alias[${WORKFLOWS_ENTRY}] expected ${expected}, got ${actual}`
  );
}

await runWithEnv({ EDITION: 'enterprise', NEXT_PUBLIC_EDITION: 'enterprise' }, async () => {
  const eeConfig = await loadNextConfigFresh();
  assertAlias(eeConfig, '../ee/server/src/workflows/entry', 'EE');
  assertWebpackAlias(
    applyWebpackConfig(eeConfig, 'EE'),
    path.join(serverDir, '../ee/server/src/workflows/entry.tsx'),
    'EE'
  );
});

await runWithEnv({ EDITION: 'community', NEXT_PUBLIC_EDITION: 'community' }, async () => {
  const ceConfig = await loadNextConfigFresh();
  assertAlias(ceConfig, './src/empty/workflows/entry', 'CE');
  assertWebpackAlias(
    applyWebpackConfig(ceConfig, 'CE'),
    path.join(serverDir, 'src/empty/workflows/entry.tsx'),
    'CE'
  );
});

console.log('[guard-workflows-entry-edition-selection] OK: env-driven workflows entry alias selection is deterministic');
