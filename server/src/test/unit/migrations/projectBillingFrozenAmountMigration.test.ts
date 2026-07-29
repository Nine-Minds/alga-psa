import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../../migrations/20260729120000_add_frozen_amount_to_project_billing_schedule_entries.cjs', import.meta.url),
  'utf8',
);

describe('project billing frozen amount migration', () => {
  it('backfills invoiced dollars from invoice charges using a tenant-scoped join', () => {
    expect(migration).toContain('SET frozen_amount = charge.net_amount');
    expect(migration).toContain('entry.tenant = charge.tenant');
    expect(migration).toContain('entry.invoice_charge_id = charge.item_id');
    expect(migration).toContain("entry.status = 'invoiced'");
  });

  it('backfills approved amount and percentage entries through their tenant-scoped config', () => {
    expect(migration).toContain('WHEN entry.amount IS NOT NULL THEN entry.amount');
    expect(migration).toContain(
      'ROUND((entry.percentage::numeric / 100) * config.total_price)::bigint',
    );
    expect(migration).toContain('entry.tenant = config.tenant');
    expect(migration).toContain('entry.config_id = config.config_id');
    expect(migration).toContain("entry.status = 'approved'");
  });

  it('validates the status/frozen invariant after the backfill', () => {
    expect(migration).toContain(
      "(status IN ('approved', 'invoiced')) = (frozen_amount IS NOT NULL)",
    );
    expect(migration).toContain('NOT VALID');
    expect(migration).toContain(
      'VALIDATE CONSTRAINT project_billing_schedule_entries_frozen_amount_check',
    );
  });
});
