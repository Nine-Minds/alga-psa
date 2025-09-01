// Dev-only postinstall hook to globally link the SDK CLI
// Skips in CI or if ALGA_SDK_SKIP_LINK is set.

import { execSync } from 'node:child_process';

const isCI = String(process.env.CI || '').toLowerCase() === 'true';
const skip = ['1', 'true', 'yes'].includes(String(process.env.ALGA_SDK_SKIP_LINK || '').toLowerCase());

if (isCI || skip) {
  console.log('[postinstall] Skipping SDK link (CI/ALGA_SDK_SKIP_LINK).');
  process.exit(0);
}

try {
  console.log('[postinstall] Building sdk/alga-client-sdk …');
  execSync('npm -w sdk/alga-client-sdk run build', { stdio: 'inherit' });
} catch (err) {
  console.warn('[postinstall] Build failed; continuing without link.', err?.message || err);
  process.exit(0);
}

try {
  console.log('[postinstall] Linking sdk/alga-client-sdk globally …');
  execSync('npm -w sdk/alga-client-sdk link', { stdio: 'inherit' });
  console.log('[postinstall] Linked: you can use the `alga` CLI globally.');
} catch (err) {
  console.warn('[postinstall] npm link failed; continuing.', err?.message || err);
}

