import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('authenticated management UI exposes only original-admin password recovery', () => {
  const server = read('ee/appliance/host-service/server.mjs');
  const routeStart = server.indexOf("if (url.pathname === '/api/admin-password-reset')");
  const nextRoute = server.indexOf("if (url.pathname === '/api/", routeStart + 1);
  const route = server.slice(routeStart, nextRoute === -1 ? undefined : nextRoute);
  const ui = read('ee/appliance/status-ui/app/manage/ManageView.tsx');

  assert.ok(routeStart >= 0, 'reset route must exist');
  assert.match(route, /requireAuth\(req, res\)/);
  assert.match(route, /runInitialAdminPasswordReset/);
  assert.doesNotMatch(route, /payload\?\.(email|tenantId)/);
  assert.match(ui, /Admin recovery/);
  assert.match(ui, /status\.adminPasswordReset/);
  assert.match(ui, /Original setup administrator unavailable/);
  assert.match(ui, /passwordConfirm/);
  assert.match(ui, /Reset Alga admin password/);
});
