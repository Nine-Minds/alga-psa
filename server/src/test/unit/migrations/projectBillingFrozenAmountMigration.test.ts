import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../../migrations/20260728220000_add_frozen_amount_to_project_billing_schedule_entries.cjs',
  import.meta.url,
);
const migrationSource = readFileSync(
  migrationUrl,
  'utf8',
);
const { approvedFrozenAmount } = createRequire(import.meta.url)(fileURLToPath(migrationUrl)) as {
  approvedFrozenAmount: (entry: {
    schedule_entry_id: string;
    amount: string | number | null;
    percentage: string | number | null;
    total_price: string | number | null;
  }) => string;
};

describe('project billing frozen amount migration', () => {
  it('backfills source values through tenant-scoped reads and literal writes', () => {
    expect(migrationSource).toContain("this.on('entry.tenant', '=', 'charge.tenant')");
    expect(migrationSource).toContain(
      ".andOn('entry.invoice_charge_id', '=', 'charge.item_id')",
    );
    expect(migrationSource).toContain("this.on('entry.tenant', '=', 'config.tenant')");
    expect(migrationSource).toContain(".andOn('entry.config_id', '=', 'config.config_id')");
    expect(migrationSource).toContain('tenant: entry.tenant');
    expect(migrationSource).not.toMatch(/UPDATE[\s\S]*SET frozen_amount[\s\S]*FROM/i);
  });

  it('reproduces application rounding for approved amount and percentage entries', () => {
    expect(approvedFrozenAmount({
      schedule_entry_id: 'amount-entry',
      amount: '12345',
      percentage: null,
      total_price: '99999',
    })).toBe('12345');
    expect(approvedFrozenAmount({
      schedule_entry_id: 'percentage-entry',
      amount: null,
      percentage: '33.3334',
      total_price: '10000',
    })).toBe('3333');
    expect(approvedFrozenAmount({
      schedule_entry_id: 'half-cent-rounds-up',
      amount: null,
      percentage: '12.5',
      total_price: '100',
    })).toBe('13');
  });

  it('fails clearly when an approved percentage entry cannot be reconstructed', () => {
    expect(() => approvedFrozenAmount({
      schedule_entry_id: 'invalid-entry',
      amount: null,
      percentage: '25',
      total_price: null,
    })).toThrow(
      'Cannot backfill approved project billing entry invalid-entry: '
      + 'percentage and total_price are required when amount is null',
    );
  });

  it('validates the status/frozen invariant after the backfill', () => {
    expect(migrationSource).toContain(
      "(status IN ('approved', 'invoiced')) = (frozen_amount IS NOT NULL)",
    );
    expect(migrationSource).toContain('NOT VALID');
    expect(migrationSource).toContain(
      'VALIDATE CONSTRAINT project_billing_schedule_entries_frozen_amount_check',
    );
  });
});
