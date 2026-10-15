import { afterAll, beforeAll, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const migration = createRequire(import.meta.url)('../20260907190000_add_project_survey_subjects.cjs');
let db: Knex;
beforeAll(() => {
  const database = process.env.DB_NAME_SERVER;
  if (!database || ['server', 'production', 'postgres'].includes(database)) throw new Error('Explicit test database required');
  db = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database,
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN,
  }, pool: { min: 0, max: 1 } });
});
afterAll(async () => { await db?.destroy(); });

it('preserves ticket subjects, enforces project tenant ownership and refuses a lossy downgrade', async () => {
  const trx = await db.transaction();
  const schema = `survey_migration_${randomUUID().replaceAll('-', '')}`;
  const tenant = randomUUID(), otherTenant = randomUUID(), ticket = randomUUID(), project = randomUUID();
  try {
    await trx.raw('CREATE SCHEMA ??', [schema]);
    await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
    for (const [table, id] of [['tickets', 'ticket_id'], ['projects', 'project_id']]) {
      await trx.schema.createTable(table, builder => {
        builder.uuid(id).notNullable(); builder.uuid('tenant').notNullable(); builder.primary([id, 'tenant']);
      });
    }
    const tables = ['survey_invitations', 'survey_responses'];
    for (const table of tables) {
      await trx.schema.createTable(table, builder => {
        builder.uuid('id').notNullable(); builder.uuid('tenant').notNullable();
        builder.uuid('ticket_id').notNullable(); builder.primary(['id', 'tenant']);
        builder.foreign(['ticket_id', 'tenant']).references(['ticket_id', 'tenant']).inTable('tickets');
      });
    }
    if (process.env.TEST_DB_BACKEND === 'citus') {
      for (const table of ['tickets', 'projects', ...tables]) {
        await trx.raw("SELECT create_distributed_table(?, 'tenant')", [`${schema}.${table}`]);
      }
    }
    await trx('tickets').insert({ ticket_id: ticket, tenant });
    await trx('projects').insert({ project_id: project, tenant });
    for (const table of tables) await trx(table).insert({ id: randomUUID(), tenant, ticket_id: ticket });
    await migration.up(trx);
    // Each expected rejection runs inside a savepoint so PostgreSQL can keep
    // executing the rest of the behavioral checks after constraint failures.
    const rejected = async (table: string, row: object, code: string) => {
      await expect(trx.transaction(async savepoint => { await savepoint(table).insert(row); })).rejects.toMatchObject({ code });
    };
    for (const table of tables) {
      expect(await trx(table).where({ tenant, ticket_id: ticket }).first()).toMatchObject({ project_id: null });
      await trx(table).insert({ id: randomUUID(), tenant, ticket_id: null, project_id: project });
      expect(await trx(table).where({ tenant, project_id: project }).first()).toMatchObject({ ticket_id: null });
      await rejected(table, { id: randomUUID(), tenant: otherTenant, project_id: project }, '23503');
      await rejected(table, { id: randomUUID(), tenant, ticket_id: ticket, project_id: project }, '23514');
      await rejected(table, { id: randomUUID(), tenant }, '23514');
    }
    await expect(migration.down(trx)).rejects.toThrow('while project invitations or responses exist');
    for (const table of tables) expect(await trx(table).where({ tenant, project_id: project }).first()).toBeTruthy();
    await trx('projects').where({ tenant, project_id: project }).delete();
    for (const table of tables) expect(await trx(table).where({ tenant, project_id: project }).first()).toBeUndefined();
    await migration.down(trx);
    for (const table of tables) {
      expect(await trx(table).where({ tenant, ticket_id: ticket }).first()).toBeTruthy();
      await rejected(table, { id: randomUUID(), tenant }, '23502');
    }
    await migration.up(trx);
  } finally { await trx.rollback(); }
}, 120_000);
