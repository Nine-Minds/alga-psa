import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { dateTriggerSourceDefinitions } from '../../../shared/workflow/runtime/dateTriggerSourceDefinitions';

const require = createRequire(import.meta.url);
const migration = require('../20261005120100_add_ticket_status_age_workflow_trigger.cjs');

describe('ticket status-age catalog migration', () => {
  it('upserts the row for the schema the source definition declares', async () => {
    const merge = vi.fn();
    const onConflict = vi.fn(() => ({ merge }));
    const insert = vi.fn(() => ({ onConflict }));
    const table = vi.fn(() => ({ insert }));
    (table as any).schema = { hasTable: vi.fn().mockResolvedValue(true) };

    await migration.up(table);

    const definition = dateTriggerSourceDefinitions.find((d) => d.id === 'ticket.status_age');
    expect(table).toHaveBeenCalledWith('system_event_catalog');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: definition?.catalogEventType,
      payload_schema_ref: definition?.payloadSchemaRef,
      created_at: '2026-10-05T00:00:00.000Z',
    }));
    expect(onConflict).toHaveBeenCalledWith('event_type');
    expect(merge).toHaveBeenCalled();
  });

  it('down deletes only its own row', async () => {
    const del = vi.fn();
    const where = vi.fn(() => ({ del }));
    const table = vi.fn(() => ({ where }));
    (table as any).schema = { hasTable: vi.fn().mockResolvedValue(true) };
    await migration.down(table);
    expect(where).toHaveBeenCalledWith({ event_type: 'TICKET_STATUS_AGE' });
    expect(del).toHaveBeenCalled();
  });
});
