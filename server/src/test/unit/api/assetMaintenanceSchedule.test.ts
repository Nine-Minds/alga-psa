import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createMaintenanceScheduleSchema,
  updateMaintenanceScheduleSchema,
  maintenanceScheduleResponseSchema,
} from '../../../lib/api/schemas/asset';

const request = {
  schedule_name: 'Biannual server maintenance',
  description: 'Check backups and updates',
  maintenance_type: 'preventive',
  frequency: 'monthly',
  frequency_interval: 6,
  schedule_config: {},
  next_maintenance: '2026-11-01T13:00:00.000Z',
};

describe('asset maintenance schedule REST contract', () => {
  it('accepts the UI/database columns and preserves the explicit due date', () => {
    expect(createMaintenanceScheduleSchema.parse(request)).toEqual({ ...request, is_active: true });
    expect(createMaintenanceScheduleSchema.parse({ ...request, maintenance_type: 'corrective' }).maintenance_type)
      .toBe('corrective');
    expect(createMaintenanceScheduleSchema.parse({ ...request, description: null }).description).toBeNull();
  });

  it.each(['schedule_name', 'maintenance_type', 'frequency', 'frequency_interval', 'schedule_config', 'next_maintenance'])(
    'requires %s on creation',
    (field) => {
      const incomplete: Record<string, unknown> = { ...request };
      delete incomplete[field];
      expect(createMaintenanceScheduleSchema.safeParse(incomplete).success).toBe(false);
    }
  );

  it.each(['schedule_type', 'notes', 'start_date', 'end_date', 'assigned_to', 'created_by', 'tenant', 'asset_id'])(
    'rejects unsupported or server-owned %s on create instead of silently discarding it',
    (field) => {
      expect(createMaintenanceScheduleSchema.safeParse({ ...request, [field]: 'obsolete' }).success).toBe(false);
    }
  );

  it.each(['schedule_type', 'notes', 'start_date', 'end_date', 'assigned_to', 'unknown_field'])(
    'rejects legacy or unknown %s on update',
    (field) => {
      expect(updateMaintenanceScheduleSchema.safeParse({ [field]: 'obsolete' }).success).toBe(false);
    }
  );

  it('ignores response-only fields on update so a GET row can be sent back', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const readBack = {
      ...request, is_active: false, schedule_id: id, asset_id: id, tenant: id, created_by: id,
      created_by_name: 'Jane Doe', created_at: request.next_maintenance, updated_at: request.next_maintenance,
      last_maintenance: null, archived_at: null,
    };
    expect(updateMaintenanceScheduleSchema.parse(readBack)).toEqual({ ...request, is_active: false });
  });

  it('requires a recurrence rule for the custom frequency', () => {
    const recurrence = { unit: 'weeks', weekdays: [1, 4] };
    const custom = { ...request, frequency: 'custom', schedule_config: { recurrence, checklist: ['Dust fans'] } };
    expect(createMaintenanceScheduleSchema.parse(custom).schedule_config).toEqual(custom.schedule_config);
    const missing = createMaintenanceScheduleSchema.safeParse({ ...request, frequency: 'custom' });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0].path).toEqual(['schedule_config', 'recurrence']);
    expect(createMaintenanceScheduleSchema.safeParse({
      ...request, frequency: 'custom', schedule_config: { recurrence: { unit: 'days', weekdays: [1] } },
    }).success).toBe(false);
    // Fixed frequencies ignore a stray rule.
    expect(createMaintenanceScheduleSchema.safeParse({ ...request, schedule_config: { recurrence: { unit: 'bogus' } } }).success).toBe(true);
    // Partial updates check the pair when both are sent; the service checks the merged row otherwise.
    expect(updateMaintenanceScheduleSchema.safeParse({ frequency: 'custom', schedule_config: {} }).success).toBe(false);
    expect(updateMaintenanceScheduleSchema.parse({ frequency: 'custom', schedule_config: { recurrence } }))
      .toEqual({ frequency: 'custom', schedule_config: { recurrence } });
    expect(updateMaintenanceScheduleSchema.safeParse({ frequency: 'custom' }).success).toBe(true);
  });

  it.each([0, -1, 1.5])('rejects frequency interval %s', (frequency_interval) => {
    expect(createMaintenanceScheduleSchema.safeParse({ ...request, frequency_interval }).success).toBe(false);
  });

  it.each(['', '   ', 'x'.repeat(256)])('rejects invalid schedule names', (schedule_name) => {
    expect(createMaintenanceScheduleSchema.safeParse({ ...request, schedule_name }).success).toBe(false);
  });

  it.each(['2026-11-01', 'invalid', '2026-11-01T09:00:00-04:00', '2026-11-01T13:00:00'])(
    'rejects non-UTC or non-datetime due date %s',
    (next_maintenance) => {
      expect(createMaintenanceScheduleSchema.safeParse({ ...request, next_maintenance }).success).toBe(false);
      expect(updateMaintenanceScheduleSchema.safeParse({ next_maintenance }).success).toBe(false);
    }
  );

  it('does not apply creation defaults to partial updates', () => {
    expect(updateMaintenanceScheduleSchema.parse({ description: 'Revised instructions' }))
      .toEqual({ description: 'Revised instructions' });
    expect(updateMaintenanceScheduleSchema.parse({ next_maintenance: request.next_maintenance }))
      .toEqual({ next_maintenance: request.next_maintenance });
  });

  it('describes actual persisted response columns without requiring phantom fields', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const row = {
      ...request, description: null, is_active: true, schedule_id: id, asset_id: id,
      created_by: id, tenant: id, last_maintenance: null, archived_at: null,
      created_at: request.next_maintenance, updated_at: request.next_maintenance,
    };
    expect(maintenanceScheduleResponseSchema.parse(row)).toEqual(row);
  });

  it.each(['ce', 'ee'])('publishes the corrected %s OpenAPI contract', (edition) => {
    const document = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, `../../../../../sdk/docs/openapi/alga-openapi.${edition}.json`), 'utf8'));
    const schemas = document.components.schemas;
    const create = schemas.AssetMaintenanceScheduleCreateRequest;
    expect(create.required).toEqual(expect.arrayContaining([
      'schedule_name', 'maintenance_type', 'frequency', 'frequency_interval', 'schedule_config', 'next_maintenance',
    ]));
    for (const name of ['AssetMaintenanceScheduleCreateRequest', 'AssetMaintenanceScheduleUpdateRequest', 'AssetMaintenanceScheduleResource']) {
      const properties = schemas[name].properties;
      expect(properties).toHaveProperty('maintenance_type');
      expect(properties).toHaveProperty('next_maintenance');
      for (const field of ['schedule_type', 'notes', 'start_date', 'end_date', 'assigned_to']) {
        expect(properties).not.toHaveProperty(field);
      }
    }
    expect(schemas.AssetMaintenanceScheduleUpdateRequest.required ?? []).toEqual([]);
    for (const name of ['AssetMaintenanceScheduleCreateRequest', 'AssetMaintenanceScheduleUpdateRequest']) {
      expect(schemas[name].properties.frequency.enum).toContain('custom');
      expect(schemas[name].properties.schedule_config.properties.recurrence.properties).toHaveProperty('unit');
    }
    expect(document.paths['/api/v1/assets/maintenance/{scheduleId}'].put.responses).toHaveProperty('404');
  });

  it.each([
    'server/src/lib/mcp/registry.generated.ts',
    'ee/server/src/chat/registry/apiRegistry.generated.ts',
  ])('publishes canonical create/update fields in %s', (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../../../', file), 'utf8');
    const marker = 'export const chatApiRegistry: ChatApiRegistryEntry[] = ';
    const entries: Array<{ id: string; requestBodySchema: { properties: Record<string, unknown> } }> =
      JSON.parse(source.slice(source.indexOf(marker) + marker.length, source.lastIndexOf('];') + 1));
    for (const id of ['post-_api_v1_assets_id_maintenance', 'put-_api_v1_assets_maintenance_scheduleid']) {
      const entry = entries.find((candidate) => candidate.id === id);
      expect(entry).toBeDefined();
      if (!entry) throw new Error(`Missing generated entry: ${id}`);
      expect(entry.requestBodySchema.properties).toHaveProperty('schedule_name');
      expect(entry.requestBodySchema.properties).toHaveProperty('next_maintenance');
      expect(entry.requestBodySchema.properties).not.toHaveProperty('schedule_type');
    }
  });
});
