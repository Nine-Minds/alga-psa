import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  assertPackagedLiteralsCurrent,
  auditCalls,
  checkFreshness,
  discoverPackagedEmulatorRoutes,
  parseCsdl,
  runValidation,
  validatePath,
} from './validate-endpoints.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'endpoints.json'), 'utf8'));
const loadModel = (version) => parseCsdl(
  gunzipSync(readFileSync(join(here, 'metadata', `${version}.xml.gz`))).toString('utf8'),
);
const withMetadata = (overrides) => ({ ...config, metadata: { ...config.metadata, ...overrides } });

test('every discovered source call and emulator route resolves against the pinned CSDL', () => {
  const result = runValidation();
  assert.ok(result.sourceCalls >= 80);
  assert.ok(result.emulatorRoutes >= 60);
  assert.ok(result.validatedPaths >= 55);
});

test('packaged emulator discovery expands literal segments instead of folding them into ids', () => {
  const routes = discoverPackagedEmulatorRoutes();
  assert.deepEqual(routes.filter((route) => route.path.includes('${')), []);
  for (const path of [
    '/users/:userId/onlineMeetings/:meetingId/recordings',
    '/users/:userId/onlineMeetings/:meetingId/transcripts/:artifactId/content',
    '/users/:userId/adhocCalls/:callId/recordings/:artifactId',
  ]) {
    assert.ok(routes.some((route) => route.path === path), `expected discovery to expand ${path}`);
  }
});

test('an emulator loop that rebinds a route literal fails discovery loudly', () => {
  const current = readFileSync(join(here, '../../packages/emulators/msgraph/src/wire.ts'), 'utf8');
  assert.doesNotThrow(() => assertPackagedLiteralsCurrent(current));

  assert.throws(
    () => assertPackagedLiteralsCurrent(current.replace("'recordings' : 'transcripts'", "'recordingz' : 'transcripts'")),
    /binds 'segment' in an undeclared way/,
  );
  assert.throws(
    () => assertPackagedLiteralsCurrent(`${current}\nconst segment = 'attendanceReports';\n`),
    /binds 'segment' in an undeclared way/,
  );
  assert.throws(
    () => assertPackagedLiteralsCurrent(current.replace("['/me', '/users/:userId']", "['/me']")),
    /route shape changed near/,
  );
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

test('a pin younger than maxAgeDays passes the freshness gate', () => {
  const pinnedAt = '2026-01-01T00:00:00Z';
  assert.equal(checkFreshness({ pinnedAt, maxAgeDays: 90 }, Date.parse('2026-03-01T00:00:00Z')), null);
  assert.doesNotThrow(() => runValidation({ config: withMetadata({ pinnedAt }), now: Date.parse('2026-03-01T00:00:00Z') }));
});

test('a pin older than maxAgeDays fails the guard rather than warning', () => {
  const pinnedAt = '2026-01-01T00:00:00Z';
  const expired = Date.parse('2026-06-01T00:00:00Z');
  assert.match(checkFreshness({ pinnedAt, maxAgeDays: 90 }, expired), /151 days old \(limit 90\)/);
  assert.throws(
    () => runValidation({ config: withMetadata({ pinnedAt }), now: expired }),
    /guard:microsoft-graph-endpoints:update/,
  );
});

test('a missing or unparsable pin date fails the guard', () => {
  assert.match(checkFreshness({ maxAgeDays: 90 }), /pinnedAt is missing/);
  assert.match(checkFreshness({ pinnedAt: 'last tuesday', maxAgeDays: 90 }), /pinnedAt is missing/);
});

test('suppressions excuse a single unresolvable call and nothing else', () => {
  const models = { 'v1.0': loadModel('v1.0') };
  const calls = [{ version: 'v1.0', method: 'GET', path: '/me/inventedThing', origin: 'source call in fake.ts' }];

  assert.match(auditCalls(models, calls).errors[0], /segment 'inventedThing' does not exist/);
  assert.deepEqual(
    auditCalls(models, calls, [{ version: 'v1.0', method: 'GET', pathTemplate: '/me/inventedThing', reason: 'test' }]).errors,
    [],
  );
  assert.match(
    auditCalls(models, calls, [{ version: 'v1.0', method: 'GET', pathTemplate: '/me/inventedThing' }]).errors[0],
    /suppression without a reason/,
  );
});

test('a suppression that matches no discovered call is reported as stale', () => {
  const models = { 'v1.0': loadModel('v1.0') };
  const suppressions = [{ version: 'v1.0', method: 'GET', pathTemplate: '/me/retiredThing', reason: 'test' }];
  assert.match(auditCalls(models, [], suppressions).errors[0], /stale suppression matches no discovered call/);
});
