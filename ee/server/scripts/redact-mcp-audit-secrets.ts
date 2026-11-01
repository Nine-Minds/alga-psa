#!/usr/bin/env tsx
/**
 * One-off remediation (alga-2026-0003021, finding f2): re-redact secrets already persisted in
 * `mcp_agent_audit.result_summary` / `.arguments` before writeAgentAudit redacted at the boundary.
 *
 * Operator-run, idempotent (re-running changes nothing), tenant-scoped. Rows are read and
 * updated with tenant + id filters only (mcp_agent_audit is tenant-distributed; no cross-shard
 * statements). Summaries that parse as JSON are re-redacted (status/ok kept); truncated,
 * unparseable summaries that still show a secret-shaped key are set to NULL.
 *
 * Usage (from repo root; DATABASE_* env as for the server):
 *   npx tsx ee/server/scripts/redact-mcp-audit-secrets.ts --tenant=<tenant-id> [--dry-run]
 *   npx tsx ee/server/scripts/redact-mcp-audit-secrets.ts --all-tenants [--dry-run]
 *
 * Already-leaked secrets must still be ROTATED again; this only removes the stored copy.
 */
import knexFactory from 'knex';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { tenantDb } from '@alga-psa/db';
import { planRowRemediation, SECRET_SHAPE_SQL } from './redactMcpAuditSecretsLogic';

const require = createRequire(import.meta.url);
const knexConfig = require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../knexfile.cjs'));
const BATCH = 200;

async function main() {
  const argv = process.argv.slice(2);
  const tenantArg = argv.find((a) => a.startsWith('--tenant='))?.slice('--tenant='.length);
  const all = argv.includes('--all-tenants');
  const dryRun = argv.includes('--dry-run');
  if (!tenantArg && !all) throw new Error('Pass --tenant=<id> or --all-tenants');

  const knex = knexFactory(knexConfig[process.env.NODE_ENV === 'production' ? 'production' : 'development'] ?? knexConfig);
  try {
    const tenants: string[] = tenantArg
      ? [tenantArg]
      : (await knex('mcp_agent_audit').distinct('tenant')).map((r: { tenant: string }) => r.tenant);

    for (const tenant of tenants) {
      const table = () => tenantDb(knex, tenant).table('mcp_agent_audit');
      let lastId: string | null = null;
      let scanned = 0;
      let changed = 0;
      for (;;) {
        let q = table()
          .select('id', 'tool', 'result_summary', 'arguments')
          .where((b: any) =>
            b.whereRaw('result_summary ~* ?', [SECRET_SHAPE_SQL]).orWhereRaw('arguments::text ~* ?', [SECRET_SHAPE_SQL]),
          )
          .orderBy('id')
          .limit(BATCH);
        if (lastId) q = q.where('id', '>', lastId);
        const rows = await q;
        if (!rows.length) break;
        for (const row of rows) {
          scanned++;
          const patch = planRowRemediation(row);
          if (!patch) continue;
          changed++;
          if (!dryRun) await table().where({ id: row.id }).update(patch);
        }
        lastId = rows[rows.length - 1].id;
      }
      console.log(`${tenant}: scanned ${scanned}, ${dryRun ? 'would change' : 'changed'} ${changed}`);
    }
  } finally {
    await knex.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
