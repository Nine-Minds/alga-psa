import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../20260923120000_add_client_anniversary_workflow_event.cjs');

describe('client anniversary event catalog migration', () => {
  it('upserts the registered payload schema with a literal timestamp', async () => {
    const merge = vi.fn();
    const onConflict = vi.fn(() => ({ merge }));
    const insert = vi.fn(() => ({ onConflict }));
    const table = vi.fn(() => ({ insert }));
    table.schema = { hasTable: vi.fn().mockResolvedValue(true) };

    await migration.up(table);

    expect(table).toHaveBeenCalledWith('system_event_catalog');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'CLIENT_ANNIVERSARY_UPCOMING',
      payload_schema_ref: 'payload.ClientAnniversaryUpcoming.v1',
      created_at: '2026-09-23T00:00:00.000Z',
      updated_at: '2026-09-23T00:00:00.000Z',
    }));
    expect(onConflict).toHaveBeenCalledWith('event_type');
    expect(merge).toHaveBeenCalled();
  });
});
