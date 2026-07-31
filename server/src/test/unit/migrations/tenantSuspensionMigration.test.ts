import { describe, expect, it, vi } from 'vitest';

const migration = require('../../../../migrations/20260724120000_add_suspension_to_tenants.cjs');

describe('tenant suspension migration', () => {
  it('T001: adds nullable suspension columns with the reason CHECK constraint', async () => {
    const hasColumn = vi.fn(async () => false);
    const raw = vi.fn(async () => undefined);

    await migration.up({ schema: { hasColumn }, raw });

    expect(hasColumn).toHaveBeenCalledWith('tenants', 'suspended_at');
    expect(hasColumn).toHaveBeenCalledWith('tenants', 'suspended_reason');
    const statements = raw.mock.calls.map(([sql]) => sql as string);
    expect(statements.some((sql) => sql.includes('ADD COLUMN suspended_at timestamptz'))).toBe(true);
    expect(statements.some((sql) => sql.includes('ADD COLUMN suspended_reason text'))).toBe(true);
    expect(statements.some((sql) =>
      sql.includes('tenants_suspended_reason_check') && sql.includes("IN ('tenant_cancelled')")
    )).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE tenants'))).toBe(false);
  });

  it('T002: up is rerunnable when columns already exist and down removes everything', async () => {
    const hasColumn = vi.fn(async () => true);
    const raw = vi.fn(async () => undefined);

    await migration.up({ schema: { hasColumn }, raw });
    expect(raw.mock.calls.every(([sql]) => !(sql as string).includes('ADD COLUMN'))).toBe(true);

    raw.mockClear();
    await migration.down({ raw });
    const statements = raw.mock.calls.map(([sql]) => sql as string);
    expect(statements.some((sql) => sql.includes('DROP CONSTRAINT IF EXISTS tenants_suspended_reason_check'))).toBe(true);
    expect(statements.some((sql) => sql.includes('DROP COLUMN IF EXISTS suspended_reason'))).toBe(true);
    expect(statements.some((sql) => sql.includes('DROP COLUMN IF EXISTS suspended_at'))).toBe(true);
  });
});
