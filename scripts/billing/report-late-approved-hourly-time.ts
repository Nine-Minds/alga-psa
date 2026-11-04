/**
 * Read-only backlog report for late approved hourly time (T0-2).
 *
 * Uses the product's own detection (findLateApprovedHourlyTime), so the report
 * can never disagree with what the next invoice will do. Prints, per tenant:
 *   1. entries that would now bill late on the next invoice
 *   2. entries outside the lookback (LATE_TIME_LOOKBACK_DAYS), which are NOT billed
 * and, per client, the same two counts with billable hours.
 *
 * Usage (from the repo root):
 *   DB_HOST=... DB_PORT=5432 DB_NAME_SERVER=server DB_USER_ADMIN=postgres \
 *   DB_PASSWORD_ADMIN=... npx tsx scripts/billing/report-late-approved-hourly-time.ts --tenant <uuid>
 *
 * Plan: docs/plans/2026-10-27-cm-t0-2-plan.md (§3 backlog report).
 */
import knex from 'knex';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  // Loaded dynamically: the package source is CommonJS-flavoured under tsx, so named
  // ESM imports are not reliable; the namespace may carry the exports on `default`.
  const loaded: any = await import('../../packages/billing/src/lib/billing/lateHourlyTime.ts');
  const { LATE_TIME_LOOKBACK_DAYS, findLateApprovedHourlyTime } = loaded.findLateApprovedHourlyTime ? loaded : loaded.default;
  const tenant = argValue('--tenant');
  if (!tenant) {
    throw new Error('--tenant <uuid> is required');
  }
  const db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME_SERVER || 'server',
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN,
    },
  });
  try {
    const notices = await findLateApprovedHourlyTime(db, tenant);
    const waiting = notices.filter((n) => n.disposition === 'next_invoice');
    const outside = notices.filter((n) => n.disposition === 'outside_lookback');
    console.log(`Late approved hourly time for tenant ${tenant} (lookback ${LATE_TIME_LOOKBACK_DAYS} days)`);
    console.log(`  would bill late on the next invoice: ${waiting.length}`);
    console.log(`  outside lookback (not billed):       ${outside.length}`);

    const byClient = new Map<string, { name: string; waiting: number; outside: number; waitingMinutes: number; outsideMinutes: number }>();
    for (const n of notices) {
      const row = byClient.get(n.clientId) ?? { name: n.clientName ?? '(unnamed client)', waiting: 0, outside: 0, waitingMinutes: 0, outsideMinutes: 0 };
      if (n.disposition === 'next_invoice') { row.waiting += 1; row.waitingMinutes += n.billableMinutes; }
      else { row.outside += 1; row.outsideMinutes += n.billableMinutes; }
      byClient.set(n.clientId, row);
    }
    for (const row of [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(
        `  ${row.name}: ${row.waiting} to bill (${(row.waitingMinutes / 60).toFixed(2)} h), ` +
        `${row.outside} outside lookback (${(row.outsideMinutes / 60).toFixed(2)} h)`,
      );
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
