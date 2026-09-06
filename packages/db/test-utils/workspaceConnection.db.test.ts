import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { expect, it, vi } from 'vitest';
import { createWorkspaceTestDbConnection } from './workspaceConnection';

it('connects with the active worker database and role instead of mixing a worker role with the base database', async () => {
  const base = process.env.TEST_DB_NAME;
  const user = process.env.DB_USER_SERVER;
  const adminPassword = process.env.DB_PASSWORD_ADMIN;
  if (!base || !user || !adminPassword) throw new Error('Run through the isolated workspace DB runner');
  const database = `${base}_scope_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN, password: adminPassword, database: 'postgres',
  } });
  let db: Knex | undefined;
  let created = false;
  try {
    await admin.raw('CREATE DATABASE ?? OWNER ??', [database, user]);
    created = true;
    vi.stubEnv('DB_NAME_SERVER', database);
    db = createWorkspaceTestDbConnection();
    const identity = await db.raw('SELECT current_database() AS database, current_user AS role');
    expect(identity.rows).toEqual([{ database, role: user }]);
    await db.schema.createTable('connection_probe', table => table.text('value').notNullable());
    await db('connection_probe').insert({ value: 'worker-local' });
    expect(await db('connection_probe').select('value')).toEqual([{ value: 'worker-local' }]);
  } finally {
    await db?.destroy();
    vi.unstubAllEnvs();
    try {
      if (created) await admin.raw('DROP DATABASE ??', [database]);
    } finally {
      await admin.destroy();
    }
  }
});
