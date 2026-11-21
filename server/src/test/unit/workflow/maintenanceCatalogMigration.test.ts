import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import { getDateTriggerSourceByCatalogEvent, WORKFLOW_EVENT_CATALOG } from '@alga-psa/event-schemas';

const require = createRequire(import.meta.url);
const migration = require('../../../../migrations/20261030163220_add_asset_maintenance_due_workflow_catalog.cjs');

describe('maintenance date-source Event Catalog migration', () => {
  it('upserts the discoverable date-source schema without claiming a publishable event', async () => {
    const merge = vi.fn();
    const onConflict = vi.fn(() => ({ merge }));
    const insert = vi.fn(() => ({ onConflict }));
    const knex = vi.fn(() => ({ insert }));
    await migration.up(knex);
    const source = getDateTriggerSourceByCatalogEvent('ASSET_MAINTENANCE_DUE');
    expect(source?.id).toBe('asset.maintenance_due');
    expect(knex).toHaveBeenCalledWith('system_event_catalog');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'ASSET_MAINTENANCE_DUE',
      name: 'Asset Maintenance Due',
      category: 'Assets',
      payload_schema_ref: source?.payloadSchemaRef,
    }));
    expect(onConflict).toHaveBeenCalledWith('event_type');
    expect(merge).toHaveBeenCalledWith(expect.objectContaining({
      payload_schema_ref: 'payload.AssetMaintenanceDue.v1',
    }));
    expect(WORKFLOW_EVENT_CATALOG).not.toHaveProperty('ASSET_MAINTENANCE_DUE');
  });

  it('rolls back only its own documentation entry', async () => {
    const del = vi.fn();
    const where = vi.fn(() => ({ del }));
    const knex = vi.fn(() => ({ where }));
    await migration.down(knex);
    expect(knex).toHaveBeenCalledWith('system_event_catalog');
    expect(where).toHaveBeenCalledWith({ event_type: 'ASSET_MAINTENANCE_DUE' });
    expect(del).toHaveBeenCalledOnce();
  });

  it('compiles an idempotent PostgreSQL upsert using the real migration facade', async () => {
    const knex = knexFactory({ client: 'pg' });
    const queries: string[] = [];
    try {
      const connection = (table: string) => {
        const query = knex(table);
        query.then = ((resolve: (value: unknown) => unknown) => {
          queries.push(query.toQuery());
          return Promise.resolve(resolve([]));
        }) as typeof query.then;
        return query;
      };
      await migration.up(connection);
      await migration.down(connection);
      expect(queries[0]).toContain('on conflict ("event_type") do update');
      expect(queries[0]).toContain('payload.AssetMaintenanceDue.v1');
      expect(queries[1]).toBe('delete from "system_event_catalog" where "event_type" = \'ASSET_MAINTENANCE_DUE\'');
    } finally {
      await knex.destroy();
    }
  });
});
