import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const uiRoot = path.join(repoRoot, 'ee', 'appliance', 'status-ui');

test('T006 setup/status UI package uses session-based auth (no query token)', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(uiRoot, 'package.json'), 'utf8'));
  const nextConfig = fs.readFileSync(path.join(uiRoot, 'next.config.mjs'), 'utf8');
  const statusPage = fs.readFileSync(path.join(uiRoot, 'app', 'page.tsx'), 'utf8');
  const setupPage = fs.readFileSync(path.join(uiRoot, 'app', 'setup', 'page.tsx'), 'utf8');
  const layout = fs.readFileSync(path.join(uiRoot, 'app', 'layout.tsx'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'ee', 'appliance', 'control-plane', 'Dockerfile'), 'utf8');

  assert.equal(packageJson.scripts.build, 'next build');
  assert.match(nextConfig, /output: 'export'/);
  assert.match(nextConfig, /distDir: 'dist'/);
  assert.match(dockerfile, /COPY --from=ui-build .*status-ui\/dist \.\/status-ui\/dist/);

  // The auth gate wraps every page; requests ride the session cookie, not ?token=.
  assert.match(layout, /<AuthGate>\{children\}<\/AuthGate>/);
  assert.match(statusPage, /fetch\(apiPath\(["']\/api\/status["']\)/);
  assert.match(statusPage, /href="\/setup\/"/);
  assert.match(setupPage, /fetch\(["']\/api\/setup\/config["']/);
  assert.match(setupPage, /fetch\(["']\/api\/setup["']/);

  // No leftover query-token threading anywhere.
  for (const source of [statusPage, setupPage]) {
    assert.doesNotMatch(source, /withToken/);
    assert.doesNotMatch(source, /tokenQuery/);
  }

  // Auth UI pieces are present.
  for (const file of ['AuthGate.tsx', 'TokenInput.tsx', 'LogoutButton.tsx', 'pin.ts']) {
    assert.equal(fs.existsSync(path.join(uiRoot, 'app', 'auth', file)), true, `missing app/auth/${file}`);
  }

  assert.equal(fs.existsSync(path.join(uiRoot, 'dist', 'index.html')), true);
  assert.equal(fs.existsSync(path.join(uiRoot, 'dist', 'setup', 'index.html')), true);
});
