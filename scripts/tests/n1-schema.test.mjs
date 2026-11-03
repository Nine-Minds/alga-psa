import assert from 'node:assert/strict';
import test from 'node:test';

import { assertN1, narrowing } from '../lib/n1-schema.mjs';

const col = (table, column, udt, extra = {}) => ({ table, column, dataType: udt, udt, charLength: null, precision: null, scale: null, datetimePrecision: null, ...extra });
const base = () => ({
  tables: ['tickets', 'comments'],
  columns: [col('tickets', 'id', 'uuid'), col('tickets', 'title', 'varchar', { charLength: 100 }), col('tickets', 'n', 'int4'), col('comments', 'body', 'text')],
  uniques: [{ table: 'tickets', name: 'tickets_pkey', kind: 'p', columns: ['id'] }],
  enums: [{ name: 'status', labels: ['open', 'closed'] }],
  ledger: [{ id: 1, name: '20260101_a.cjs', batch: 1 }, { id: 2, name: '20260102_b.cjs', batch: 1 }],
});
const clone = (x) => JSON.parse(JSON.stringify(x));
const names = (b, a) => assertN1(b, a).map((f) => f.assertion);

test('an unchanged or purely additive schema is compatible', () => {
  const a = clone(base());
  a.tables.push('new_table');
  a.columns.push(col('tickets', 'extra', 'text'), col('new_table', 'id', 'uuid'));
  a.enums[0].labels.push('pending');
  a.ledger.push({ id: 3, name: '20260103_c.cjs', batch: 2 });
  assert.deepEqual(assertN1(base(), a), []);
});

test('ledger: removal, rebatching and an id change are failures; an early-sorting new row is not (lint rule 6 owns that)', () => {
  let a = clone(base());
  a.ledger.pop();
  assert.deepEqual(names(base(), a), ['ledger-append-only']);
  a = clone(base());
  a.ledger[0].batch = 7;
  assert.deepEqual(names(base(), a), ['ledger-append-only']);
  a = clone(base());
  a.ledger[1].id = 9;
  assert.deepEqual(names(base(), a), ['ledger-append-only']);
  a = clone(base());
  a.ledger.push({ id: 3, name: '20251231_old.cjs', batch: 2 });
  assert.deepEqual(names(base(), a), []);
});

test('dropped table and dropped or renamed column', () => {
  let a = clone(base());
  a.tables = ['tickets'];
  a.columns = a.columns.filter((c) => c.table !== 'comments');
  assert.deepEqual(names(base(), a), ['table-dropped']);
  a = clone(base());
  a.columns = a.columns.filter((c) => c.column !== 'title');
  const f = assertN1(base(), a);
  assert.deepEqual(f.map((x) => x.subject), ['tickets.title']);
});

test('type narrowing: shorter varchar, text -> varchar, int8 -> int4, bounded numeric, enum label removed', () => {
  const a = clone(base());
  a.columns.find((c) => c.column === 'title').charLength = 50;
  a.columns.find((c) => c.column === 'body').udt = 'varchar';
  a.columns.find((c) => c.column === 'body').charLength = 1000;
  a.enums[0].labels = ['open'];
  assert.deepEqual(names(base(), a).sort(), ['type-narrowed', 'type-narrowed', 'type-narrowed']);
});

test('type widening is allowed', () => {
  const a = clone(base());
  a.columns.find((c) => c.column === 'title').charLength = 200;
  a.columns.find((c) => c.column === 'n').udt = 'int8';
  assert.deepEqual(assertN1(base(), a), []);
  assert.equal(narrowing(col('t', 'c', 'varchar', { charLength: 10 }), col('t', 'c', 'text')), null);
  assert.equal(narrowing(col('t', 'c', 'int4'), col('t', 'c', 'numeric')), null);
});

test('numeric precision and scale may not shrink; timestamp precision may not shrink', () => {
  const n = (p, s) => col('t', 'c', 'numeric', { precision: p, scale: s });
  assert.equal(narrowing(n(10, 2), n(12, 4)), null);
  assert.match(narrowing(n(10, 2), n(8, 2)), /precision/);
  assert.match(narrowing(n(10, 4), n(10, 2)), /precision or scale/);
  assert.match(narrowing(n(10, 2), n(10, 0)), /precision or scale/);
  assert.match(narrowing(col('t', 'c', 'timestamptz', { datetimePrecision: 6 }), col('t', 'c', 'timestamptz', { datetimePrecision: 3 })), /precision/);
  assert.match(narrowing(col('t', 'c', 'timestamp'), col('t', 'c', 'timestamptz')), /different type/);
});

test('primary key loss fails; a renamed constraint with the same columns passes', () => {
  let a = clone(base());
  a.uniques = [];
  assert.deepEqual(names(base(), a), ['unique-dropped']);
  a = clone(base());
  a.uniques[0].name = 'tickets_id_pk';
  assert.deepEqual(assertN1(base(), a), []);
});
