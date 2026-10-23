import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeWorkflowEventEmitSites } from '../lib/workflow-event-emit-sites.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures/workflow-event-emit-sites/clean');

const base = {
  catalogFile: 'catalog.ts',
  tsConfigFilePath: 'tsconfig.json',
  productGlobs: ['*.ts'],
  excludeGlobs: ['catalog.ts'],
  contractGlobs: ['contracts/**/*.ts'],
  brandMintAllowedFiles: ['publishers.ts'],
  transportImplementationFiles: ['publishers.ts'],
  untypedWrappers: [],
  castSinks: [],
};

function run(overlays = {}, extra = {}) {
  return analyzeWorkflowEventEmitSites(fixture, { ...base, ...extra, overlays });
}
const codes = (r) => r.violations.map((v) => v.code).sort();

test('the clean fixture passes', () => {
  const r = run();
  assert.deepEqual(r.violations, []);
  assert.ok(r.stats.registeredFunctions >= 1);
});

test('an inline object literal payload for a catalogued event fails', () => {
  const r = run({
    'bad.ts': `import { publishWorkflowEvent } from './publishers';
      export const f = () => publishWorkflowEvent({ eventType: 'THING_CREATED', payload: { thingId: 'x' } as never, ctx: {} });`,
  });
  assert.deepEqual(codes(r), ['unbuilt-payload']);
});

test('a builder the registry never exercises fails', () => {
  const r = run({
    'orphan.ts': `import { builtWorkflowPayload } from './publishers';
      export const buildOrphan = () => builtWorkflowPayload('THING_DELETED', { id: 'x' });`,
  });
  assert.deepEqual(codes(r), ['unregistered-builder']);
});

test('a publish whose payload comes from an unregistered builder fails', () => {
  const r = run({
    'orphan.ts': `import { builtWorkflowPayload, publishWorkflowEvent } from './publishers';
      const buildOrphan = () => builtWorkflowPayload('THING_DELETED', { id: 'x' });
      export const f = () => publishWorkflowEvent({ eventType: 'THING_DELETED', payload: buildOrphan(), ctx: {} });`,
  });
  assert.deepEqual(codes(r), ['unregistered-builder', 'unbuilt-payload'].sort());
});

test('by-name publishing fails even for a non-catalogued type', () => {
  const r = run({
    'byname.ts': `import { publishEventByName } from './publishers';
      export const f = () => publishEventByName({ eventType: 'THING_TOUCHED', payload: {} });`,
  });
  assert.deepEqual(codes(r), ['by-name-publish']);
});

test('publishEvent with a catalogued event type fails; non-catalogued passes', () => {
  const r = run({
    'raw.ts': `import { publishEvent } from './publishers';
      export const f = () => publishEvent({ eventType: 'THING_DELETED', payload: {} });`,
  });
  assert.deepEqual(codes(r), ['catalogued-untyped-publish']);
});

test('a raw EventBus.publish of a catalogued event fails', () => {
  const r = run({
    'rawbus.ts': `import { getEventBus } from './publishers';
      export const f = () => getEventBus().publish({ eventType: 'THING_CREATED', payload: {} });`,
  });
  assert.deepEqual(codes(r), ['raw-transport-catalogued']);
});

test('a raw EventBus.publish whose event type is not a literal fails', () => {
  const r = run({
    'rawbus.ts': `import { getEventBus } from './publishers';
      export const f = (eventType: string) => getEventBus().publish({ eventType, payload: {} });`,
  });
  assert.deepEqual(codes(r), ['raw-transport-unresolvable']);
});

test('publishUnregisteredEventType must cite the defect ticket', () => {
  const bad = run({
    'defect.ts': `import { publishUnregisteredEventType } from './publishers';
      export const f = () => publishUnregisteredEventType({ eventType: 'X', payload: {} });`,
  });
  assert.deepEqual(codes(bad), ['uncited-defect-publish']);
  const ok = run({
    'defect.ts': `import { publishUnregisteredEventType } from './publishers';
      export const f = () =>
        // KNOWN DEFECT alga-2026-0002675: not in EVENT_TYPES
        publishUnregisteredEventType({ eventType: 'X', payload: {} });`,
  });
  assert.deepEqual(codes(ok), []);
});

test('untyped wrappers (calendar-style) are checked at their call sites', () => {
  const wrappers = [{ file: 'wrapper.ts', name: 'publishEvent', eventTypeProps: ['eventType'] }];
  const files = {
    'wrapper.ts': `import { getEventBus } from './publishers';
      export async function publishEvent(event: { eventType: string }): Promise<void> { await getEventBus().publish(event as any); }`,
  };
  const ok = run({ ...files, 'caller.ts': `import { publishEvent } from './wrapper';
      export const f = () => publishEvent({ eventType: 'THING_TOUCHED' });` }, { untypedWrappers: wrappers });
  assert.deepEqual(codes(ok), []);
  const bad = run({ ...files, 'caller.ts': `import { publishEvent } from './wrapper';
      export const f = () => publishEvent({ eventType: 'THING_DELETED' });` }, { untypedWrappers: wrappers });
  assert.deepEqual(codes(bad), ['untyped-wrapper-catalogued']);
});

test('cast sinks fail when their declared event names become catalogued', () => {
  const sinks = [{ file: 'sync.ts', eventNameAlias: 'SyncEventName' }];
  const ok = run({ 'sync.ts': `export type SyncEventName = 'SYNC_STARTED';` }, { castSinks: sinks });
  assert.deepEqual(codes(ok), []);
  const bad = run({ 'sync.ts': `export type SyncEventName = 'SYNC_STARTED' | 'THING_CREATED';` }, { castSinks: sinks });
  assert.deepEqual(codes(bad), ['cast-sink-catalogued']);
});

test('a publisher reached through a cast or alias (not a direct call) fails', () => {
  const r = run({
    'cast.ts': `import { publishWorkflowEvent } from './publishers';
      export const f = () => (publishWorkflowEvent as any)({ eventType: 'THING_CREATED', payload: {}, ctx: {} });
      export const alias = publishWorkflowEvent;`,
  });
  assert.deepEqual(codes(r), ['indirect-publisher-reference', 'indirect-publisher-reference']);
});
