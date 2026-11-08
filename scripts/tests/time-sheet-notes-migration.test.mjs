import assert from 'node:assert/strict';
import test from 'node:test';
import migration from '../../server/migrations/20261101130000_move_time_sheet_notes_to_history.cjs';

test('time sheet notes are retained in history before the legacy column is dropped', async () => {
  const rows = [
    { tenant: 'tenant-a', id: 'sheet-1', user_id: 'user-1', notes: 'Keep this note' },
  ];
  const inserted = [];
  const operations = [];

  const knex = (tableName) => {
    if (tableName === 'time_sheets') {
      let hasCursor = false;
      const query = {
        select() { return this; },
        whereNotNull() { return this; },
        whereRaw() { hasCursor = true; return this; },
        orderBy() { return this; },
        limit() { return this; },
        then(resolve, reject) { return Promise.resolve(hasCursor ? [] : rows).then(resolve, reject); },
      };
      return query;
    }
    assert.equal(tableName, 'time_sheet_notes');
    return {
      where(criteria) {
        return {
          first: async () => {
            operations.push(['find-retained', criteria]);
            return undefined;
          },
        };
      },
      insert(record) {
        return {
          onConflict: () => ({ ignore: async () => { inserted.push(record); operations.push(['insert-note']); } }),
        };
      },
    };
  };
  knex.schema = {
    hasTable: async () => true,
    hasColumn: async () => true,
    alterTable: async (tableName, callback) => {
      const table = { dropColumn: (column) => operations.push(['drop-column', tableName, column]) };
      callback(table);
    },
  };
  knex.raw = async (sql) => { operations.push(['raw', sql]); };
  knex.fn = { now: () => 'database-now' };

  await migration.up(knex);

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].kind, 'legacy');
  assert.equal(inserted[0].note, 'Keep this note');
  assert.equal(inserted[0].created_by, null);
  const dropIndex = operations.findIndex((operation) => operation[0] === 'drop-column');
  assert.ok(dropIndex > -1);
  assert.equal(operations[dropIndex][2], 'notes');
  assert.ok(operations.findIndex((operation) => operation[0] === 'insert-note') < dropIndex,
    'the legacy note is inserted before the column drop');
  assert.match(operations.find((operation) => operation[0] === 'raw' && operation[1].includes('ADD CONSTRAINT'))[1], /NOT VALID$/);
});
