/**
 * Registry of maintenance fan-out schedule rows contributed outside the native
 * catalog. Job descriptors normally register through `defineJob({ schedule })`;
 * a scheduler-only process can also register shared schedule data directly.
 *
 * Dependency-free like `maintenanceFanoutSchedules.ts`, so both schedulers can
 * read it: the EE Temporal worker (`setupSchedules.ts`, via
 * `listMaintenanceFanoutSchedules()`, which is EE-only and appends
 * `listExtensionMaintenanceSchedules('ee')`) and the CE pg-boss converger (via
 * `resolveCeMaintenanceSchedules`, which appends `listExtensionMaintenanceSchedules('ce')`).
 * A scheduler only sees rows registered in its own process. The server loads
 * descriptors for execution; independent scheduler processes register their
 * schedule data in their own registry.
 *
 * Empty by default: every listing is element-for-element the native catalog.
 */

export type MaintenanceScheduleEdition = 'ce' | 'ee';

export interface MaintenanceScheduleRow {
  jobName: string;
  cron: string;
  /** Edition that schedules this row. Absent means both. */
  edition?: MaintenanceScheduleEdition;
}

const REGISTRY_KEY = '__algaMaintenanceScheduleExtensions';

function registry(): Map<string, MaintenanceScheduleRow> {
  const g = globalThis as Record<string, unknown>;
  return (g[REGISTRY_KEY] ??= new Map<string, MaintenanceScheduleRow>()) as Map<string, MaintenanceScheduleRow>;
}

/**
 * Register one schedule row. Throws when `jobName` is already registered or is
 * listed in `reservedJobNames` (the native catalog, passed by the caller so this
 * module stays free of a circular import).
 */
export function registerMaintenanceSchedule(
  row: MaintenanceScheduleRow,
  reservedJobNames: Iterable<string> = [],
): void {
  if (!row.jobName) throw new Error('registerMaintenanceSchedule: jobName is required');
  for (const reserved of reservedJobNames) {
    if (reserved === row.jobName) {
      throw new Error(`registerMaintenanceSchedule: "${row.jobName}" is a native maintenance schedule`);
    }
  }
  if (registry().has(row.jobName)) {
    throw new Error(`registerMaintenanceSchedule: duplicate schedule for "${row.jobName}"`);
  }
  registry().set(row.jobName, Object.freeze({ ...row }));
}

/** Registered rows the given edition schedules, in registration order. */
export function listExtensionMaintenanceSchedules(
  edition: MaintenanceScheduleEdition,
): Array<{ jobName: string; cron: string }> {
  return [...registry().values()]
    .filter((row) => row.edition === undefined || row.edition === edition)
    .map(({ jobName, cron }) => ({ jobName, cron }));
}

/** Test-only. */
export function resetMaintenanceScheduleExtensions(): void {
  registry().clear();
}
