/**
 * Job descriptors: maintenance jobs declared as data and registered through
 * `defineJob()`. The fan-out resolves `MAINTENANCE_JOBS[name] ?? descriptor`, so
 * native jobs always win and an empty descriptor map changes nothing.
 *
 * Schedule rows are not read from here: `@alga-psa/types` cannot import this
 * package, so a descriptor's `schedule` is declarative and the matching row is
 * contributed through `JOB_SCHEDULE_EXTENSIONS`.
 */
// LEVERAGE: pattern job-registry-dup — three job registries (pg-boss, fan-out map, hand-maintained name list)

import type { TenantDb } from '@alga-psa/db';

export type JobDescriptorTenantSelector = (db: TenantDb) => PromiseLike<Array<{ tenant: string }>>;

interface JobDescriptorBase {
  name: string;
  schedule?: { cron: string };
  capability?: string;
  edition?: 'ce' | 'ee';
}

export type JobDescriptor =
  | (JobDescriptorBase & {
      scope: 'tenant';
      run: (tenantId: string) => Promise<unknown>;
      tenants?: JobDescriptorTenantSelector;
      concurrency?: number;
      /** Include suspended tenants in the fan-out. Default false (native behaviour). */
      includeSuspended?: boolean;
    })
  | (JobDescriptorBase & { scope: 'system'; run: () => Promise<unknown> });

const REGISTRY_KEY = '__algaJobDescriptors';

function registry(): Map<string, JobDescriptor> {
  const g = globalThis as Record<string, unknown>;
  return (g[REGISTRY_KEY] ??= new Map<string, JobDescriptor>()) as Map<string, JobDescriptor>;
}

const CRON_FIELD = /^(\*|\d+(-\d+)?|[A-Za-z]{3}(-[A-Za-z]{3})?)(\/\d+)?(,(\*|\d+(-\d+)?|[A-Za-z]{3}(-[A-Za-z]{3})?)(\/\d+)?)*$/;

export function isValidCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field) => CRON_FIELD.test(field));
}

export function defineJob(descriptor: JobDescriptor): JobDescriptor {
  if (!descriptor.name || typeof descriptor.name !== 'string') {
    throw new Error('defineJob: name is required');
  }
  if (registry().has(descriptor.name)) {
    throw new Error(`defineJob: duplicate job name "${descriptor.name}"`);
  }
  if (descriptor.schedule && !isValidCron(descriptor.schedule.cron)) {
    throw new Error(`defineJob: malformed cron "${descriptor.schedule.cron}" for job "${descriptor.name}"`);
  }
  registry().set(descriptor.name, descriptor);
  return descriptor;
}

export function getJobDescriptor(name: string): JobDescriptor | undefined {
  return registry().get(name);
}

export function listJobDescriptorNames(): string[] {
  return [...registry().keys()];
}

/** Test-only. */
export function resetJobDescriptors(): void {
  registry().clear();
}
