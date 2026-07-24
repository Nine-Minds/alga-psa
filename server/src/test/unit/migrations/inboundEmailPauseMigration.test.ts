import { describe, expect, it, vi } from 'vitest';

const migration = require('../../../../migrations/20260723180000_add_inbound_pause_to_email_providers.cjs');

describe('inbound email pause migration', () => {
  it('T001: adds nullable pause columns without rewriting existing rows', async () => {
    const timestamp = vi.fn(() => ({ nullable: vi.fn() }));
    const text = vi.fn(() => ({ nullable: vi.fn() }));
    const alterTable = vi.fn(async (_table: string, callback: (table: any) => void) => {
      callback({ timestamp, text });
    });
    const raw = vi.fn(async () => undefined);
    const knex = { schema: { alterTable }, raw };

    await migration.up(knex);

    expect(alterTable).toHaveBeenCalledWith('email_providers', expect.any(Function));
    expect(timestamp).toHaveBeenCalledWith('inbound_paused_at', { useTz: true });
    expect(text).toHaveBeenCalledWith('inbound_pause_reason');
    expect(raw).toHaveBeenCalledWith(expect.stringContaining("'tenant_cancelled'"));
    expect(knex).not.toHaveProperty('update');
  });

  it('T002: removes the constraint and both pause columns cleanly', async () => {
    const dropColumn = vi.fn();
    const alterTable = vi.fn(async (_table: string, callback: (table: any) => void) => {
      callback({ dropColumn });
    });
    const raw = vi.fn(async () => undefined);

    await migration.down({ schema: { alterTable }, raw });

    expect(raw).toHaveBeenCalledWith(expect.stringContaining('DROP CONSTRAINT IF EXISTS'));
    expect(dropColumn.mock.calls.map(([column]) => column)).toEqual([
      'inbound_pause_reason',
      'inbound_paused_at',
    ]);
  });
});
