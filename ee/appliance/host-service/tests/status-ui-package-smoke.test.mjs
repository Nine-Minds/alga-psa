import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const uiRoot = path.join(repoRoot, 'ee', 'appliance', 'status-ui');

test('T006 setup/status UI package preserves tokenized setup and status flow', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(uiRoot, 'package.json'), 'utf8'));
  const nextConfig = fs.readFileSync(path.join(uiRoot, 'next.config.mjs'), 'utf8');
  const statusPage = fs.readFileSync(path.join(uiRoot, 'app', 'page.tsx'), 'utf8');
  const setupPage = fs.readFileSync(path.join(uiRoot, 'app', 'setup', 'page.tsx'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'ee', 'appliance', 'control-plane', 'Dockerfile'), 'utf8');

  assert.equal(packageJson.scripts.build, 'next build');
  assert.match(nextConfig, /output: 'export'/);
  assert.match(nextConfig, /distDir: 'dist'/);
  assert.match(dockerfile, /COPY --from=ui-build .*status-ui\/dist \.\/status-ui\/dist/);

  assert.match(statusPage, /fetch\(apiPath\('\/api\/status', query\)/);
  assert.match(statusPage, /href=\{withToken\('\/setup\/', query\)\}/);
  assert.match(setupPage, /fetch\(withToken\('\/api\/setup\/config', query\)/);
  assert.match(setupPage, /fetch\(withToken\('\/api\/setup', query\)/);
  assert.match(setupPage, /href=\{withToken\('\/', query\)\}/);

  assert.equal(fs.existsSync(path.join(uiRoot, 'dist', 'index.html')), true);
  assert.equal(fs.existsSync(path.join(uiRoot, 'dist', 'setup', 'index.html')), true);
});
