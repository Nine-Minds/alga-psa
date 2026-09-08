import knex from 'knex';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareUpgradeSchema } from './lib/upgrade-schema-source.mjs';
import { captureUpgradeRecords, verifyUpgradeRetention } from './lib/upgrade-retention.mjs';
import { testRevision } from './lib/test-revision.mjs';
import { seedUpgradeV150 } from './fixtures/upgrade-v150';

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const database = process.env.UPGRADE_DB_NAME;
  if (process.env.UPGRADE_DATABASE_ISOLATED !== 'true' || !/^upgrade_[a-z0-9_]{1,50}$/.test(database || '')) {
    throw new Error('Set UPGRADE_DATABASE_ISOLATED=true and a fresh UPGRADE_DB_NAME starting with upgrade_');
  }
  const hashedPassword = process.env.UPGRADE_TEST_PASSWORD_HASH;
  if (!hashedPassword?.includes(':')) throw new Error('Set UPGRADE_TEST_PASSWORD_HASH for an isolated browser test account');
  if (!process.env.DB_PASSWORD_ADMIN) throw new Error('DB_PASSWORD_ADMIN is required');
  const source = testRevision(root);
  const baseline = JSON.parse(readFileSync(path.join(root, 'ee/docs/plans/2026-09-05-production-regression-prevention/upgrade-baseline.json'), 'utf8'));
  const output = mkdtempSync(path.join(tmpdir(), 'alga-supported-upgrade-'));
  const report: any = { schemaVersion: 1, phase: 'schema-and-retention', status: 'failed', database, source, baseline, output,
    limitations: ['Browser behavior and application tenant isolation require separate execution.', 'Migration dependencies use the installed candidate dependency tree.'] };
  let db: ReturnType<typeof knex> | undefined;
  const connection = (name: string) => ({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres', password: process.env.DB_PASSWORD_ADMIN, database: name });
  try {
    const schemas = [baseline.commit, source.revision].map((commit, index) => {
      const destination = path.join(output, index ? 'candidate' : 'baseline');
      const schema = prepareUpgradeSchema({ repository: root, commit, destination, edition: 'ee' });
      symlinkSync(path.join(root, 'node_modules'), path.join(destination, 'node_modules'));
      return { ...schema, destination };
    });
    const admin = knex({ client: 'pg', connection: connection('postgres') });
    try { await admin.raw('CREATE DATABASE ??', [database]); } finally { await admin.destroy(); }
    // CREATE DATABASE deliberately fails on an existing database; never reset or adopt it.
    db = knex({ client: 'pg', connection: connection(database!), pool: { min: 0, max: 5 } });
    process.env.DB_NAME_SERVER = database;
    process.chdir(path.join(schemas[0].destination, 'server'));
    await db.migrate.latest({ directory: schemas[0].directory, loadExtensions: ['.cjs'] });
    const fixture = await seedUpgradeV150(db, hashedPassword, schemas[0].destination);
    writeFileSync(path.join(output, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
    const ledger = () => db!('knex_migrations').select('id', 'name', 'batch').orderBy('id');
    const baselineLedger = await ledger();
    const before = await captureUpgradeRecords(db, fixture);
    process.chdir(path.join(schemas[1].destination, 'server'));
    const [batch, applied] = await db.migrate.latest({ directory: schemas[1].directory, loadExtensions: ['.cjs'] });
    verifyUpgradeRetention(before, await captureUpgradeRecords(db, fixture), baselineLedger, await ledger());
    if (process.env.DB_USER_SERVER) {
      await db.raw('GRANT CONNECT ON DATABASE ?? TO ??', [database, process.env.DB_USER_SERVER]);
      await db.raw('GRANT USAGE ON SCHEMA public TO ??', [process.env.DB_USER_SERVER]);
      await db.raw('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ??', [process.env.DB_USER_SERVER]);
      await db.raw('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ??', [process.env.DB_USER_SERVER]);
    }
    report.migrations = { baseline: baselineLedger.length, upgrade: applied, batch };
    report.status = 'passed';
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await db?.destroy();
    report.sourceAfter = testRevision(root);
    if (report.sourceAfter.revision !== source.revision) { report.status = 'failed'; process.exitCode = 1; }
    writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
    if (process.env.UPGRADE_OUTPUT_POINTER) writeFileSync(process.env.UPGRADE_OUTPUT_POINTER, output + '\n');
    console.log(`Upgrade ${report.status}: ${path.join(output, 'evidence.json')}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
