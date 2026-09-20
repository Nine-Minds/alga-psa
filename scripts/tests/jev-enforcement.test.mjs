import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyBrowserPolicy, applyIntegrationPolicy, loadJevSelection, providerFloorFiles } from '../lib/jev-enforcement.mjs';

const revision = 'a'.repeat(40);

test('a judgment applies only when judged, in enforce mode, for the exact revision', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jev-enforce-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'jev-selection.json');
  const write = data => writeFileSync(file, JSON.stringify(data));
  assert.match(loadJevSelection({ file, revision }).reason, /No jev-selection artifact/);
  writeFileSync(file, '{');
  assert.match(loadJevSelection({ file, revision }).reason, /Unreadable/);
  write({ schemaVersion: 1, status: 'unavailable', reason: 'no key', mode: 'enforce', head: revision });
  assert.match(loadJevSelection({ file, revision }).reason, /unavailable: no key/);
  write({ schemaVersion: 1, status: 'judged', mode: 'shadow', head: revision });
  assert.match(loadJevSelection({ file, revision }).reason, /shadow mode/);
  write({ schemaVersion: 1, status: 'judged', mode: 'enforce', head: 'b'.repeat(40) });
  assert.match(loadJevSelection({ file, revision }).reason, /different|not aaaaaaaaaa/);
  write({ schemaVersion: 1, status: 'judged', mode: 'enforce', head: revision, threshold: 0.5 });
  const loaded = loadJevSelection({ file, revision });
  assert.equal(loaded.status, 'applied');
  assert.equal(loaded.selection.threshold, 0.5);
});

test('integration policy keeps the floor and the graph, prunes only confident non-matches, and adds confident matches', () => {
  const judgments = [
    { file: 'server/src/test/integration/floor.test.ts', probability: 0.01 },
    { file: 'server/src/test/integration/graphKeep.test.ts', probability: 0.3 },
    { file: 'server/src/test/integration/graphPrune.test.ts', probability: 0.1 },
    { file: 'server/src/test/integration/added.test.ts', probability: 0.8 },
    { file: 'server/src/test/integration/ignored.test.ts', probability: 0.49 },
    { file: 'server/src/test/integration/changed.test.ts', probability: 0.0 },
  ];
  const policy = applyIntegrationPolicy({
    floor: ['server/src/test/integration/floor.test.ts'],
    affected: ['server/src/test/integration/floor.test.ts', 'server/src/test/integration/graphKeep.test.ts', 'server/src/test/integration/graphPrune.test.ts', 'server/src/test/integration/unjudged.test.ts'],
    always: ['server/src/test/integration/changed.test.ts'],
    judgments, threshold: 0.5, pruneThreshold: 0.2,
  });
  assert.deepEqual(policy.run, [
    'server/src/test/integration/added.test.ts', 'server/src/test/integration/changed.test.ts', 'server/src/test/integration/floor.test.ts',
    'server/src/test/integration/graphKeep.test.ts', 'server/src/test/integration/unjudged.test.ts',
  ]);
  assert.deepEqual(policy.pruned, [{ file: 'server/src/test/integration/graphPrune.test.ts', probability: 0.1 }]);
  assert.deepEqual(policy.added, [{ file: 'server/src/test/integration/added.test.ts', probability: 0.8 }]);
  assert.deepEqual(policy.graph.map(entry => [entry.file.split('/').pop(), entry.probability]), [['graphKeep.test.ts', 0.3], ['unjudged.test.ts', null]]);
  const noPrune = applyIntegrationPolicy({ affected: ['server/src/test/integration/graphPrune.test.ts'], judgments, threshold: 0.5, pruneThreshold: 0 });
  assert.deepEqual(noPrune.pruned, []);
});

test('browser policy forces floor and changed journeys, runs unjudged cases, and emits location filters', () => {
  const entry = (file, title, line, project = 'enterprise-chromium') => ({ file, projectId: project, projectName: project, titles: [title], line });
  const cases = [
    entry('e2e-tests/tests/login.spec.ts', 'signs in', 5),
    entry('e2e-tests/tests/qbo-export.spec.ts', 'exports', 9),
    entry('e2e-tests/tests/invoice-generation.spec.ts', 'generates', 12),
    entry('e2e-tests/tests/invoice-generation.spec.ts', 'manual', 40),
    entry('e2e-tests/tests/microsoft-calendar.spec.ts', 'recovers from outage', 20),
    entry('e2e-tests/tests/microsoft-calendar.spec.ts', 'recovers from throttling', 20),
    entry('e2e-tests/tests/new-journey.spec.ts', 'brand new', 3),
    entry('e2e-tests/tests/portal-identity.spec.ts', 'changed spec', 7),
  ];
  const judgments = [
    { file: 'e2e-tests/tests/login.spec.ts', title: 'signs in', probability: 0.05 },
    { file: 'e2e-tests/tests/invoice-generation.spec.ts', title: 'generates', probability: 0.9 },
    { file: 'e2e-tests/tests/invoice-generation.spec.ts', title: 'manual', probability: 0.1 },
    { file: 'e2e-tests/tests/microsoft-calendar.spec.ts', title: 'recovers from ${mode}', probability: 0.6 },
    { file: 'e2e-tests/tests/portal-identity.spec.ts', title: 'changed spec', probability: 0.0 },
  ];
  const policy = applyBrowserPolicy({ cases, judgments, floorFiles: ['e2e-tests/tests/login.spec.ts', 'e2e-tests/tests/qbo-export.spec.ts'],
    changedFiles: ['e2e-tests/tests/portal-identity.spec.ts', 'server/src/test/integration/x.test.ts'], threshold: 0.5 });
  assert.deepEqual(policy.selected.map(entry => [entry.titles[0], entry.reason]), [
    ['signs in', 'floor'], ['exports', 'floor'], ['generates', 'p=0.90'],
    ['recovers from outage', 'p=0.60'], ['recovers from throttling', 'p=0.60'], ['brand new', 'unjudged'], ['changed spec', 'floor'],
  ]);
  assert.deepEqual(policy.deferred, [{ identity: ['e2e-tests/tests/invoice-generation.spec.ts', 'enterprise-chromium', 'enterprise-chromium', ['manual']], probability: 0.1 }]);
  assert.deepEqual(policy.filters, ['tests/invoice-generation.spec.ts:12', 'tests/login.spec.ts:5', 'tests/microsoft-calendar.spec.ts:20',
    'tests/new-journey.spec.ts:3', 'tests/portal-identity.spec.ts:7', 'tests/qbo-export.spec.ts:9']);
  assert.throws(() => applyBrowserPolicy({ cases: [{ ...cases[0], line: undefined }], judgments: [], threshold: 0.5 }), /no location/);
});

test('the provider floor is every journey file the readiness policy names for an edition', () => {
  const policy = { editions: { enterprise: { requirements: [
    { identity: ['e2e-tests/tests/qbo-export.spec.ts', 'p', 'p', ['a']] },
    { identity: ['e2e-tests/tests/stripe-payment.spec.ts', 'p', 'p', ['b']] },
    { identity: ['e2e-tests/tests/stripe-payment.spec.ts', 'p', 'p', ['c']] },
  ] } } };
  assert.deepEqual(providerFloorFiles(policy, 'enterprise'), ['e2e-tests/tests/qbo-export.spec.ts', 'e2e-tests/tests/stripe-payment.spec.ts']);
  assert.deepEqual(providerFloorFiles(policy, 'community'), []);
});
