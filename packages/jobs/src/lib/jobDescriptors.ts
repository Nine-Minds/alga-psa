/**
 * Job descriptors: maintenance jobs declared as data and registered through
 * `defineJob()`. The fan-out (`maintenanceJobFanout.ts`) consults this registry
 * after its native map; with nothing registered every native path is unchanged.
 *
 * - `schedule` registers a `maintenance-fanout:<name>` row in `@alga-psa/types`
 *   (`registerMaintenanceSchedule`), which the EE Temporal worker and the CE
 *   pg-boss converger both read. `edition` limits that row to one edition.
 * - `capability` gates a tenant job: before any tenant SQL the fan-out checks
 *   that a capability filter is registered (`registerJobCapabilityFilter`, wired
 *   by the capability gate) and otherwise skips the run; with a filter it runs
 *   only for the tenants the filter returns.
 * - A descriptor name may not collide with a native job or native schedule.
 */
// LEVERAGE: pattern job-registry-dup — three job registries (pg-boss, fan-out map, hand-maintained name list)

import type { TenantDb } from '@alga-psa/db';
import {
  CE_ONLY_MAINTENANCE_SCHEDULES,
  CE_SHARED_MAINTENANCE_JOBS,
  MAINTENANCE_FANOUT_SCHEDULES,
  registerMaintenanceSchedule,
  resetMaintenanceScheduleExtensions,
  type MaintenanceScheduleEdition,
} from '@alga-psa/types';

export type JobDescriptorTenantSelector = (db: TenantDb) => PromiseLike<Array<{ tenant: string }>>;

interface JobDescriptorBase {
  name: string;
  schedule?: { cron: string };
  /** Edition whose scheduler creates the schedule row. Absent means both. */
  edition?: MaintenanceScheduleEdition;
}

export type JobDescriptor =
  | (JobDescriptorBase & {
      scope: 'tenant';
      run: (tenantId: string) => Promise<unknown>;
      tenants?: JobDescriptorTenantSelector;
      concurrency?: number;
      /** Include suspended tenants in the fan-out. Default false (native behaviour). */
      includeSuspended?: boolean;
      /** Run only for tenants the registered capability filter serves; skipped when none is registered. */
      capability?: string;
    })
  | (JobDescriptorBase & { scope: 'system'; run: () => Promise<unknown> });

/** Batch capability filter: the subset of `tenantIds` served by `capability`. */
export type JobCapabilityFilter = (capability: string, tenantIds: readonly string[]) => Promise<string[]>;

interface JobRegistryState {
  descriptors: Map<string, JobDescriptor>;
  nativeJobProbe?: (name: string) => boolean;
  capabilityFilter?: JobCapabilityFilter;
}

const REGISTRY_KEY = '__algaJobDescriptors';

function state(): JobRegistryState {
  const g = globalThis as Record<string, unknown>;
  const existing = g[REGISTRY_KEY] as JobRegistryState | undefined;
  if (existing && existing.descriptors instanceof Map) return existing;
  const fresh: JobRegistryState = { descriptors: new Map() };
  g[REGISTRY_KEY] = fresh;
  return fresh;
}

const NATIVE_SCHEDULE_NAMES: readonly string[] = [
  ...MAINTENANCE_FANOUT_SCHEDULES.map((row) => row.jobName),
  ...CE_SHARED_MAINTENANCE_JOBS,
  ...CE_ONLY_MAINTENANCE_SCHEDULES.map((row) => row.jobName),
];

const CRON_FIELD = /^(\*|\d+(-\d+)?|[A-Za-z]{3}(-[A-Za-z]{3})?)(\/\d+)?(,(\*|\d+(-\d+)?|[A-Za-z]{3}(-[A-Za-z]{3})?)(\/\d+)?)*$/;

export function isValidCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field) => CRON_FIELD.test(field));
}

export function defineJob(descriptor: JobDescriptor): JobDescriptor {
  const { descriptors, nativeJobProbe } = state();
  if (!descriptor.name || typeof descriptor.name !== 'string') {
    throw new Error('defineJob: name is required');
  }
  if (descriptors.has(descriptor.name)) {
    throw new Error(`defineJob: duplicate job name "${descriptor.name}"`);
  }
  if (nativeJobProbe?.(descriptor.name) || NATIVE_SCHEDULE_NAMES.includes(descriptor.name)) {
    throw new Error(`defineJob: "${descriptor.name}" is a native maintenance job`);
  }
  if (descriptor.schedule && !isValidCron(descriptor.schedule.cron)) {
    throw new Error(`defineJob: malformed cron "${descriptor.schedule.cron}" for job "${descriptor.name}"`);
  }
  if (descriptor.edition && !descriptor.schedule) {
    throw new Error(`defineJob: "${descriptor.name}" declares an edition but no schedule`);
  }
  if (descriptor.schedule) {
    registerMaintenanceSchedule(
      { jobName: descriptor.name, cron: descriptor.schedule.cron, edition: descriptor.edition },
      NATIVE_SCHEDULE_NAMES,
    );
  }
  descriptors.set(descriptor.name, descriptor);
  return descriptor;
}

export function getJobDescriptor(name: string): JobDescriptor | undefined {
  return state().descriptors.get(name);
}

export function listJobDescriptorNames(): string[] {
  return [...state().descriptors.keys()];
}

/**
 * Called by the fan-out module at load so `defineJob` can reject native names.
 * Descriptors registered before the probe existed are checked now.
 */
export function setNativeJobProbe(probe: (name: string) => boolean): void {
  const s = state();
  s.nativeJobProbe = probe;
  const clash = [...s.descriptors.keys()].find(probe);
  if (clash) throw new Error(`defineJob: "${clash}" is a native maintenance job`);
}

/** Wire the capability gate's batch filter (e.g. `filterServed`). Re-registering replaces it. */
export function registerJobCapabilityFilter(filter: JobCapabilityFilter): void {
  state().capabilityFilter = filter;
}

export function getJobCapabilityFilter(): JobCapabilityFilter | undefined {
  return state().capabilityFilter;
}

/** Test-only. Clears descriptors, their schedule rows and the capability filter; keeps the native probe. */
export function resetJobDescriptors(): void {
  const s = state();
  s.descriptors.clear();
  s.capabilityFilter = undefined;
  resetMaintenanceScheduleExtensions();
}
