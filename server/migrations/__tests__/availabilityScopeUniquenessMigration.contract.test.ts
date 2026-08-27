import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20260827120000_enforce_availability_scope_uniqueness.cjs'));

describe('availability scope uniqueness migration', () => {
  it('deduplicates deterministically before adding all three tenant-scoped guards', async () => {
    const raw = vi.fn().mockResolvedValue({ rows: [] });
    await migration.up({ raw });
    const sql = raw.mock.calls.map(([statement]) => statement.replace(/\s+/g, ' ').trim()).join('\n');

    expect(sql).toContain('ORDER BY updated_at DESC, created_at DESC, availability_setting_id DESC');
    expect(sql).toContain('PARTITION BY tenant, user_id, day_of_week');
    expect(sql).toContain('PARTITION BY tenant, service_id');
    expect(sql).toContain('PARTITION BY tenant ORDER BY');
    expect(sql).toContain('UNIQUE INDEX IF NOT EXISTS availability_settings_user_day_unique ON availability_settings (tenant, user_id, day_of_week)');
    expect(sql).toContain('UNIQUE INDEX IF NOT EXISTS availability_settings_service_unique ON availability_settings (tenant, service_id)');
    expect(sql).toContain('UNIQUE INDEX IF NOT EXISTS availability_settings_general_unique ON availability_settings (tenant)');
    expect(raw.mock.calls.findIndex(([statement]) => statement.includes('DELETE FROM availability_settings')))
      .toBeLessThan(raw.mock.calls.findIndex(([statement]) => statement.includes('CREATE UNIQUE INDEX')));
  });
});
