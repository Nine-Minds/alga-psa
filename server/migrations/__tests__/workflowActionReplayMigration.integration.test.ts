import { afterAll, beforeAll, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { encryptActionReplay, decryptActionReplay } from '../../../shared/workflow/runtime/utils/actionReplayCipher';

const migration = createRequire(import.meta.url)('../20260907210000_add_workflow_action_replay_output.cjs');
let db: Knex;
beforeAll(() => {
  const database = process.env.DB_NAME_SERVER;
  if (!database || ['server', 'production', 'postgres'].includes(database)) throw new Error('Explicit test database required');
  db = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database,
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN }, pool: { min: 0, max: 1 } });
});
afterAll(async () => { await db?.destroy(); });

it('preserves legacy output and refuses a downgrade that would discard protected retry results', async () => {
  const trx = await db.transaction();
  const tenant = randomUUID(), invocationId = randomUUID();
  try {
    const schema = `workflow_replay_migration_${randomUUID().replaceAll('-', '')}`;
    await trx.raw('CREATE SCHEMA ??', [schema]);
    await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
    await trx.schema.createTable('workflow_action_invocations', table => {
      table.uuid('tenant').notNullable(); table.uuid('invocation_id').notNullable();
      table.jsonb('output_json'); table.primary(['tenant', 'invocation_id']);
    });
    if (process.env.TEST_DB_BACKEND === 'citus') {
      await trx.raw("SELECT create_distributed_table(?, 'tenant')", [`${schema}.workflow_action_invocations`]);
    }
    await trx('workflow_action_invocations').insert({ tenant, invocation_id: invocationId, output_json: { result: 'legacy' } });
    await migration.up(trx);
    expect(await trx('workflow_action_invocations').first()).toMatchObject({ output_json: { result: 'legacy' }, replay_output_encrypted: null });
    const key = 'synthetic-migration-key';
    const identity = { tenantId: tenant, invocationId };
    const encrypted = encryptActionReplay({ secretRef: 'private-result' }, key, identity);
    await trx('workflow_action_invocations').where({ tenant, invocation_id: invocationId }).update({
      output_json: { secretRef: '[REDACTED]' }, replay_output_encrypted: encrypted,
    });
    await expect(migration.down(trx)).rejects.toThrow('while encrypted results exist');
    const row = await trx('workflow_action_invocations').where({ tenant, invocation_id: invocationId }).first();
    expect(decryptActionReplay(row.replay_output_encrypted, key, identity)).toEqual({ secretRef: 'private-result' });
    expect(row.output_json).toEqual({ secretRef: '[REDACTED]' });
    // Only an empty protected-result set permits a non-destructive downgrade.
    await trx('workflow_action_invocations').delete();
    await migration.down(trx);
    await trx('workflow_action_invocations').insert({ tenant, invocation_id: invocationId, output_json: { result: 'legacy' } });
    expect(await trx('workflow_action_invocations').first()).toMatchObject({ output_json: { result: 'legacy' } });
  } finally { await trx.rollback(); }
});
