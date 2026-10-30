// Applies patches/ via patch-package after installs.
//
// Skips (exit 0) when patch-package isn't installed — production images install with
// --omit=dev (Dockerfile:32) and don't need these development repairs. The
// manifest patch's writer is gated on Turbopack's dev flag; readers no-op on
// stock manifests. Flight ancestry pruning targets development bundles only.
// Fails loudly when patch-package IS
// present but a patch no longer applies — that's the tripwire on Next upgrades:
// re-validate the patched functions and regenerate the patch, don't skip it
// (losing it silently brings back the dev-server manifest OOM; see
// docs/architecture/package-build-system.md "Server-action barrels & the RSC manifest").
//
// Note: `npm run install:ignore` (--ignore-scripts) bypasses this — run
// `node scripts/postinstall-patches.cjs` manually afterwards.
let bin;
try {
  bin = require.resolve('patch-package/dist/index.js');
} catch {
  console.log('[postinstall] patch-package not installed (prod/omit=dev install) — skipping patches/');
  process.exit(0);
}
const { spawnSync } = require('child_process');
const result = spawnSync(process.execPath, [bin], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const nextRoot = require('path').dirname(require.resolve('next/package.json'));
const { patchNextFlightDebug } = require('./lib/patch-next-flight-debug.cjs');
console.log(`[postinstall] React Flight dev ancestry repair validated in ${patchNextFlightDebug(nextRoot)} bundles.`);
