import { describe, expect, it } from 'vitest';
import { createMaintenanceScheduleSchema, updateMaintenanceScheduleSchema } from './asset.schema';

const request = {
  asset_id: '11111111-1111-4111-8111-111111111111',
  schedule_name: 'Quarterly deep clean',
  maintenance_type: 'preventive',
  frequency: 'quarterly',
  frequency_interval: 1,
  schedule_config: {},
  next_maintenance: '2026-11-01'
};

// The CHECK constraint on asset_maintenance_schedules was widened to include
// 'corrective' (migration 20260728100000) and both the REST schema and the
// dialog offer it; this schema is the action-layer gate in front of them.
const TYPES = ['preventive', 'corrective', 'inspection', 'calibration', 'replacement'] as const;

describe('maintenance schedule schemas', () => {
  it('accepts every maintenance type the database allows', () => {
    for (const maintenance_type of TYPES) {
      expect(createMaintenanceScheduleSchema.parse({ ...request, maintenance_type }).maintenance_type)
        .toBe(maintenance_type);
      expect(updateMaintenanceScheduleSchema.parse({ maintenance_type }).maintenance_type)
        .toBe(maintenance_type);
    }
  });

  it('still rejects a type the database would refuse', () => {
    expect(createMaintenanceScheduleSchema.safeParse({ ...request, maintenance_type: 'emergency' }).success)
      .toBe(false);
  });
});
