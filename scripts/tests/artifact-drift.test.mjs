import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import { applyAllow, nonAdditiveChanges } from '../ci/artifact-drift.mjs';
import { writeDocument } from '../../sdk/scripts/lib/write-openapi-document.mjs';

test('OpenAPI artifacts are identical for shared and copied schema values and preserve their data', (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-output-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const maintenanceType = { type: 'string', enum: ['preventive', 'corrective', 'inspection'] };
  const document = {
    openapi: '3.0.3',
    components: {
      schemas: {
        CreateMaintenance: { type: 'object', properties: { maintenance_type: maintenanceType } },
        UpdateMaintenance: { type: 'object', properties: { maintenance_type: { ...maintenanceType } } },
        Maintenance: { type: 'object', properties: { maintenance_type: maintenanceType } },
      },
    },
  };
  const copied = JSON.parse(JSON.stringify(document));
  writeDocument(outputDir, 'shared', ['json', 'yaml'], document);
  writeDocument(outputDir, 'copied', ['json', 'yaml'], copied);

  for (const format of ['json', 'yaml']) {
    const sharedOutput = fs.readFileSync(path.join(outputDir, `shared.${format}`), 'utf8');
    const copiedOutput = fs.readFileSync(path.join(outputDir, `copied.${format}`), 'utf8');
    assert.equal(sharedOutput, copiedOutput, `${format} output must depend on values, not object identity`);
    assert.deepEqual(format === 'json' ? JSON.parse(sharedOutput) : YAML.parse(sharedOutput), copied);
  }
});

const doc = (over = {}) => ({
  paths: {
    '/things': {
      get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } } } },
      post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateThing' } } } }, responses: { 201: {} } },
    },
  },
  components: {
    schemas: {
      Thing: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['a', 'b'] } }, required: ['id'] },
      CreateThing: { type: 'object', properties: { name: { type: 'string', maxLength: 10 } }, required: ['name'] },
    },
  },
  ...over,
});
const clone = (d) => JSON.parse(JSON.stringify(d));
const kinds = (b, a) => nonAdditiveChanges(b, a).map((c) => c.kind);

test('identical documents are additive', () => assert.deepEqual(nonAdditiveChanges(doc(), doc()), []));

test('new paths, methods, schemas, optional properties and enum values are additive', () => {
  const a = clone(doc());
  a.paths['/other'] = { get: { responses: {} } };
  a.paths['/things'].delete = { responses: {} };
  a.components.schemas.New = { type: 'object' };
  a.components.schemas.Thing.properties.extra = { type: 'string' };
  a.components.schemas.Thing.enum = undefined;
  a.components.schemas.Thing.properties.kind.enum.push('c');
  a.components.schemas.Thing.required.push('kind'); // response schema: a new required field is additive
  assert.deepEqual(nonAdditiveChanges(doc(), a), []);
});

test('removed path, method, schema, property and enum value are breaking', () => {
  const a = clone(doc());
  delete a.paths['/things'].get;
  delete a.components.schemas.CreateThing;
  delete a.components.schemas.Thing.properties.id;
  a.components.schemas.Thing.properties.kind.enum = ['a'];
  const k = kinds(doc(), a);
  assert.ok(k.filter((x) => x === 'removed').length >= 3);
  assert.ok(k.includes('enum-removed'));
  const b = clone(doc());
  delete b.paths['/things'];
  assert.deepEqual(kinds(doc(), b), ['removed']);
});

test('type change is breaking', () => {
  const a = clone(doc());
  a.components.schemas.Thing.properties.id.type = 'integer';
  assert.deepEqual(kinds(doc(), a), ['type-changed']);
});

test('a newly required field is breaking only on a request schema', () => {
  const a = clone(doc());
  a.components.schemas.CreateThing.properties.other = { type: 'string' };
  a.components.schemas.CreateThing.required.push('other');
  assert.deepEqual(kinds(doc(), a), ['required-added']);
});

test('tightening a request constraint is breaking, loosening is not', () => {
  const a = clone(doc());
  a.components.schemas.CreateThing.properties.name.maxLength = 5;
  assert.deepEqual(kinds(doc(), a), ['constraint-tightened']);
  const b = clone(doc());
  b.components.schemas.CreateThing.properties.name.maxLength = 50;
  assert.deepEqual(nonAdditiveChanges(doc(), b), []);
});

test('a new required parameter is breaking, an optional one is not', () => {
  const b = clone(doc());
  b.paths['/things'].get.parameters = [{ in: 'query', name: 'q', schema: { type: 'string' } }];
  const a1 = clone(b);
  a1.paths['/things'].get.parameters.push({ in: 'query', name: 'opt', schema: { type: 'string' } });
  assert.deepEqual(nonAdditiveChanges(b, a1), []);
  const a2 = clone(b);
  a2.paths['/things'].get.parameters.push({ in: 'query', name: 'must', required: true, schema: { type: 'string' } });
  assert.deepEqual(kinds(b, a2), ['required-added']);
});

test('allow entries match by pointer prefix and need to be per-document', () => {
  const a = clone(doc());
  delete a.paths['/things'];
  const changes = nonAdditiveChanges(doc(), a);
  const allow = [{ doc: 'x.json', pointer: '/paths/~1things', reason: 'endpoint retired in this release' }];
  assert.equal(applyAllow(changes, 'x.json', allow).left.length, 0);
  assert.equal(applyAllow(changes, 'y.json', allow).left.length, 1);
});
