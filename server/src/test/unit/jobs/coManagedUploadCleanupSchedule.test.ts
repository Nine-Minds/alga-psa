import { describe, expect, it } from 'vitest';
import { listMaintenanceFanoutSchedules, resolveCeMaintenanceSchedules } from '@alga-psa/types';

// Schedule parity: both schedulers read the catalog statically. Nothing here calls
// registerServerMaintenanceJobs / prepareMaintenanceRegistry, which neither the EE Temporal
// setup nor CE convergence runs before listing schedules.
describe('co-managed-upload-cleanup is scheduled without server boot', () => {
  it('EE lists it with the hourly cron', () => {
    expect(listMaintenanceFanoutSchedules()).toContainEqual({ jobName: 'co-managed-upload-cleanup', cron: '17 * * * *' });
  });
  it('CE lists it with the same cron as EE', () => {
    expect(resolveCeMaintenanceSchedules({})).toContainEqual({ jobName: 'co-managed-upload-cleanup', cron: '17 * * * *' });
  });
  it('is listed exactly once in each edition', () => {
    expect(listMaintenanceFanoutSchedules().filter(s => s.jobName === 'co-managed-upload-cleanup')).toHaveLength(1);
    expect(resolveCeMaintenanceSchedules({}).filter(s => s.jobName === 'co-managed-upload-cleanup')).toHaveLength(1);
  });
});
