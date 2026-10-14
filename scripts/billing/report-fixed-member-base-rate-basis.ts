/**
 * Read-only report for migration 20261012000001_fixed_member_base_rate_basis.
 *
 * Runs the migration's own classification statement (shared SQL) inside a
 * READ ONLY transaction and prints:
 *   1. counts per (basis, reason)
 *   2. ambiguous lines (equal quantities > 1, no line rate to compare): these
 *      keep `per_unit`, i.e. today's invoice total
 *   3. every INHERITED line (no contract_lines.custom_rate) whose derived fee
 *      changes: before (rate x quantity for every member) vs after (share
 *      members contribute their rate as-is)
 *
 * Usage (from the repo root; run it before the migration is applied, or after
 * it for the not-yet-classified remainder):
 *   DB_HOST=... DB_PORT=5432 DB_NAME_SERVER=server DB_USER_ADMIN=postgres \
 *   DB_PASSWORD_ADMIN=... npx tsx scripts/billing/report-fixed-member-base-rate-basis.ts [--tenant <uuid>]
 *
 * Plan: docs/plans/2026-10-12-fixed-line-base-rate-meaning-plan.md (§4).
 */
import { createRequire } from 'node:module';
import knex from 'knex';

const require = createRequire(import.meta.url);
const { buildClassificationSql } = require('../../server/migrations/utils/fixedMemberBasisClassification.cjs') as {
  buildClassificationSql: (options?: { hasBasisColumn?: boolean }) => string;
};

interface ClassifiedRow {
  tenant: string;
  config_id: string;
  contract_line_id: string | null;
  base_rate_basis: 'per_unit' | 'share';
  reason: string;
}

const NON_BUNDLE_REASONS = new Set(['unit', 'product', 'other']);

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const tenantFilter = argValue('--tenant');
  const db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME_SERVER || process.env.DB_NAME || 'server',
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN,
    },
    pool: { min: 0, max: 1 },
  });

  try {
    await db.transaction(async (trx) => {
      await trx.raw('SET TRANSACTION READ ONLY');
      const hasBasisColumn = await trx.schema.hasColumn('contract_line_service_fixed_config', 'base_rate_basis');
      const result = await trx.raw(buildClassificationSql({ hasBasisColumn }));
      const rows = (result.rows as ClassifiedRow[]).filter((row) => !tenantFilter || row.tenant === tenantFilter);

      const counts = new Map<string, number>();
      for (const row of rows) {
        const key = `${row.base_rate_basis}/${row.reason}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      console.log('== classification counts (basis/reason: rows)');
      for (const [key, count] of [...counts].sort()) console.log(`${key}: ${count}`);

      const ambiguous = new Set(rows.filter((r) => r.reason === 'ambiguous').map((r) => `${r.tenant}\t${r.contract_line_id}`));
      console.log(`\n== ambiguous lines kept per_unit (${ambiguous.size}) tenant<TAB>contract_line_id`);
      for (const line of ambiguous) console.log(line);

      const bundleRows = rows.filter((r) => r.contract_line_id && !NON_BUNDLE_REASONS.has(r.reason));
      const basisByConfig = new Map(bundleRows.map((r) => [`${r.tenant}:${r.config_id}`, r.base_rate_basis]));
      const lineIds = [...new Set(bundleRows.map((r) => r.contract_line_id as string))];
      console.log('\n== inherited lines whose derived fee changes: tenant, line, before, after');
      let changed = 0;
      if (lineIds.length > 0) {
        const members = await trx('contract_line_service_configuration as clsc')
          .join('contract_lines as cl', function () {
            this.on('cl.tenant', 'clsc.tenant').andOn('cl.contract_line_id', 'clsc.contract_line_id');
          })
          .leftJoin('contract_line_services as cls', function () {
            this.on('cls.tenant', 'clsc.tenant')
              .andOn('cls.contract_line_id', 'clsc.contract_line_id')
              .andOn('cls.service_id', 'clsc.service_id');
          })
          .leftJoin('contract_line_service_fixed_config as fc', function () {
            this.on('fc.tenant', 'clsc.tenant').andOn('fc.config_id', 'clsc.config_id');
          })
          .whereIn('clsc.contract_line_id', lineIds)
          .whereNull('cl.custom_rate')
          .select(
            'clsc.tenant',
            'clsc.config_id',
            'clsc.contract_line_id',
            trx.raw('COALESCE(clsc.quantity, cls.quantity, 1)::numeric AS qty'),
            trx.raw('fc.base_rate AS rate'),
          );
        const perLine = new Map<string, { tenant: string; line: string; before: number; after: number }>();
        for (const member of members as Array<Record<string, any>>) {
          const basis = basisByConfig.get(`${member.tenant}:${member.config_id}`);
          if (!basis || member.rate == null) continue;
          const key = `${member.tenant}:${member.contract_line_id}`;
          const entry = perLine.get(key) ?? { tenant: member.tenant, line: member.contract_line_id, before: 0, after: 0 };
          const perUnit = Math.round(Number(member.rate) * Number(member.qty));
          entry.before += perUnit;
          entry.after += basis === 'share' ? Math.round(Number(member.rate)) : perUnit;
          perLine.set(key, entry);
        }
        for (const entry of perLine.values()) {
          if (entry.before === entry.after) continue;
          changed += 1;
          console.log(`${entry.tenant}\t${entry.line}\t${entry.before}\t${entry.after}`);
        }
      }
      console.log(`(${changed} lines)`);
    });
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
