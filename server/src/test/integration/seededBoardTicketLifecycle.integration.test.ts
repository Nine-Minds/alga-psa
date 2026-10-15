import { afterAll, beforeAll, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ticket from '@alga-psa/tickets/models/ticket';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

const require = createRequire(import.meta.url);
const seedDirectory = fileURLToPath(new URL('../../../seeds/dev/', import.meta.url));
const { tenantDb } = require('../../../migrations/utils/tenantDb.cjs');
let db: Knex;

const databaseName = `seed_lifecycle_test_${randomUUID().replaceAll('-', '')}`;

beforeAll(async () => {
  // Bootstrap a private database even when this is the first suite in a shard.
  // Never recreate TEST_DB_NAME or the database used by a running application.
  db = await createTestDbConnection({ databaseName, runSeeds: false });
}, 180_000);
afterAll(async () => {
  await db?.destroy();
  const admin = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
  }, pool: { min: 0, max: 1 } });
  try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
  finally { await admin.destroy(); }
});

// Execute the real CommonJS seed without modifying the shared require cache.
// Only tenant selection is replaced; SQL, catalog data and seed behavior remain real.
async function runSeed(filename: string, trx: Knex.Transaction, tenant: string) {
  const file = path.join(seedDirectory, filename);
  const module = { exports: {} as { seed: (db: Knex.Transaction) => Promise<void> } };
  const localRequire = createRequire(file);
  const seedRequire = (name: string) => name === './_tenant.cjs'
    ? { getFirstTenantSeedContext: async () => ({ tenantId: tenant, db: tenantDb(trx, tenant) }) }
    : localRequire(name);
  new Function('require', 'module', 'exports', readFileSync(file, 'utf8'))(seedRequire, module, module.exports);
  await module.exports.seed(trx);
}

// Production incident #3338: fixtures that invent their own closed statuses
// cannot catch a fresh installation whose actual seeds provide none.
it.each(['demo', 'ITIL'])('%s board seeds support opening and closing a persisted ticket (#3338)', async kind => {
  const trx = await db.transaction();
  const tenant = randomUUID();
  const user = randomUUID();
  const client = randomUUID();
  try {
    await trx('tenants').insert({ tenant, client_name: 'Seed lifecycle regression', email: `${tenant}@example.test` });
    await trx('users').insert({ tenant, user_id: user, username: 'glinda', email: `${user}@example.test`,
      first_name: 'Seed', last_name: 'Operator', user_type: 'internal', hashed_password: 'not-used-for-authentication' });
    await trx('clients').insert({ tenant, client_id: client, client_name: 'Seed lifecycle customer' });
    for (const name of ['Support A', 'Support B']) {
      await trx('boards').insert({ tenant, board_id: randomUUID(), board_name: name, is_default: name === 'Support A', is_inactive: false });
    }
    await runSeed('07_statuses.cjs', trx, tenant);
    await runSeed('85_itil_priorities.cjs', trx, tenant);
    const boards = await trx('boards').where({ tenant });
    const selected = boards.filter(board => kind === 'ITIL' ? board.board_name === 'ITIL Support' : board.board_name !== 'ITIL Support');
    expect(selected).toHaveLength(kind === 'ITIL' ? 1 : 2);
    for (const board of selected) {
      const statuses = await trx('statuses').where({ tenant, board_id: board.board_id, status_type: 'ticket' });
      const open = statuses.find(status => status.is_default && !status.is_closed);
      const closed = statuses.find(status => status.is_closed);
      expect(open, `${board.board_name} must have a default open status`).toBeDefined();
      expect(closed, `${board.board_name} must have a closed status`).toBeDefined();
      const { ticket_id } = await Ticket.insert(trx, tenant, { title: 'Seeded lifecycle', ticket_number: `SEED-${board.board_id}`,
        client_id: client, board_id: board.board_id, status_id: open!.status_id, entered_by: user });
      await Ticket.update(trx, tenant, ticket_id, { status_id: closed!.status_id });
      const persisted = await trx('tickets as t').join('statuses as s', function () {
        this.on('t.tenant', 's.tenant').andOn('t.status_id', 's.status_id');
      }).where({ 't.tenant': tenant, 't.ticket_id': ticket_id }).first('s.is_closed', 's.board_id');
      expect(persisted).toEqual({ is_closed: true, board_id: board.board_id });
    }
  } finally { await trx.rollback(); }
});
