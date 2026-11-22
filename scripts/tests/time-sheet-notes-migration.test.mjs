import assert from 'node:assert/strict';
import test from 'node:test';
import migration from '../../server/migrations/20261107100000_move_time_sheet_notes_to_history.cjs';

test('time sheet notes are retained in history while the legacy column remains for N-1 compatibility', async () => {
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
  assert.equal(operations.some((operation) => operation[0] === 'drop-column'), false,
    'the legacy column remains available to the previous application version');
  assert.match(operations.find((operation) => operation[0] === 'raw' && operation[1].includes('ADD CONSTRAINT'))[1], /NOT VALID$/);
});
