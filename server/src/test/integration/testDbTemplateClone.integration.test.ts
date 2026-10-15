import { describe, it, expect, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection, schemaTemplateName } from '../../../test-utils/dbConfig';
import path from 'node:path';

/**
 * The suite bootstrap builds the migrated+seeded schema once into a template
 * database and clones it per file. Verify the clone is a faithful copy and
 * that a second bootstrap reuses the template instead of migrating again.
 */
describe('test database schema template clone', () => {
  const connections: Knex[] = [];
  afterAll(async () => {
    for (const db of connections) await db.destroy().catch(() => undefined);
  });

  const serverRoot = path.resolve(__dirname, '..', '..', '..');
  const templateName = schemaTemplateName(
    process.env.TEST_MIGRATIONS_DIR || path.join(serverRoot, 'migrations'),
    path.join(serverRoot, 'seeds', 'dev'),
    true,
  );

  it('bootstraps the suite database from a content-addressed template', async () => {
    if (process.env.TEST_DB_TEMPLATE_CLONE === '0' || process.env.TEST_DB_BACKEND === 'citus') return;

    const first = await createTestDbConnection();
    connections.push(first);
    const template = await first.raw('SELECT 1 FROM pg_database WHERE datname = ?', [templateName]);
    expect(template.rows).toHaveLength(1);

    const [{ count: tables }] = (await first.raw(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
    )).rows;
    const [{ count: migrations }] = (await first.raw('SELECT count(*)::int AS count FROM knex_migrations')).rows;
    const [{ count: tenants }] = (await first.raw('SELECT count(*)::int AS count FROM tenants')).rows;
    expect(tables).toBeGreaterThan(100);
    expect(migrations).toBeGreaterThan(100);
    expect(tenants).toBeGreaterThan(0);

    // Dirty the database, then bootstrap again: the clone must be pristine and fast.
    await first.raw("CREATE TABLE template_clone_probe (id int)");
    await first.destroy();
    const startedAt = Date.now();
    const second = await createTestDbConnection();
    connections.push(second);
    const elapsedMs = Date.now() - startedAt;

    const probe = await second.raw("SELECT to_regclass('public.template_clone_probe') AS reg");
    expect(probe.rows[0].reg).toBeNull();
    const [{ count: tablesAgain }] = (await second.raw(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
    )).rows;
    const [{ count: migrationsAgain }] = (await second.raw('SELECT count(*)::int AS count FROM knex_migrations')).rows;
    expect(tablesAgain).toBe(tables);
    expect(migrationsAgain).toBe(migrations);
    // Replaying ~1000 migrations takes 15s+; a template copy takes about a second.
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
