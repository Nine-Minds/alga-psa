import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseCsdl, runValidation, validatePath } from './validate-endpoints.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const loadModel = (version) => parseCsdl(
  gunzipSync(readFileSync(join(here, 'metadata', `${version}.xml.gz`))).toString('utf8'),
);

test('the checked-in registry, source calls, and emulator routes agree', () => {
  const result = runValidation();
  assert.ok(result.endpoints >= 50);
  assert.ok(result.sourceCalls >= 50);
  assert.ok(result.emulatorRoutes >= 20);
});

test('rejects the fictitious Lighthouse managedTenants users relationship', () => {
  const failure = validatePath(loadModel('beta'), '/tenantRelationships/managedTenants/users');
  assert.match(failure, /segment 'users' does not exist/);
});

test('rejects managedTenants on v1.0', () => {
  const failure = validatePath(loadModel('v1.0'), '/tenantRelationships/managedTenants/tenants');
  assert.match(failure, /segment 'managedTenants' does not exist|unknown root/);
});

test('accepts calendarView delta and rejects the invented events delta route', () => {
  const model = loadModel('v1.0');
  assert.equal(validatePath(model, '/me/calendarView/delta'), null);
  assert.match(validatePath(model, '/me/calendar/events/delta'), /segment 'delta' is not published/);
});
