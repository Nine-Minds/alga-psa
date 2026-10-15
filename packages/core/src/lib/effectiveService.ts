import type { ProjectServiceSource } from '@alga-psa/types';

/**
 * Single source of truth for the task → phase → project service fallback.
 *
 * Lives in core (horizontal) because both scheduling (work-item queries that
 * prefill the time entry) and projects (the inheritance hint under a task's
 * service picker) resolve the same precedence, and vertical feature packages
 * must not import each other.
 */

/** Table or query aliases holding each level's own `service_id` column. */
export interface EffectiveServiceAliases {
  task: string;
  phase: string;
  project: string;
}

/** `service_catalog` join aliases, one per hierarchy level. */
export type EffectiveServiceCatalogAliases = EffectiveServiceAliases;

/** The effective service id: the task's own, else the phase's, else the project's. */
export function effectiveServiceIdSql(aliases: EffectiveServiceAliases): string {
  return `COALESCE(${aliases.task}.service_id, ${aliases.phase}.service_id, ${aliases.project}.service_id)`;
}

/**
 * Which level supplied the effective id. NULL when no level sets one, so the UI
 * shows no provenance badge rather than an empty one.
 */
export function effectiveServiceSourceSql(aliases: EffectiveServiceAliases): string {
  return `CASE`
    + ` WHEN ${aliases.task}.service_id IS NOT NULL THEN 'task'`
    + ` WHEN ${aliases.phase}.service_id IS NOT NULL THEN 'phase'`
    + ` WHEN ${aliases.project}.service_id IS NOT NULL THEN 'project'`
    + ` ELSE NULL END`;
}

/**
 * The effective service's name. Safe to COALESCE in the same order as the ids:
 * each level's catalog row exists whenever that level's `service_id` is set
 * (composite FK to service_catalog), so the first non-null name is the name of
 * the service `effectiveServiceIdSql` picked.
 */
export function effectiveServiceNameSql(catalogAliases: EffectiveServiceCatalogAliases): string {
  return `COALESCE(${catalogAliases.task}.service_name, ${catalogAliases.phase}.service_name, ${catalogAliases.project}.service_name)`;
}

/** JS-side twin of `effectiveServiceSourceSql`, for rows already in memory. */
export function resolveEffectiveServiceSource(serviceIds: {
  task?: string | null;
  phase?: string | null;
  project?: string | null;
}): ProjectServiceSource | null {
  if (serviceIds.task) return 'task';
  if (serviceIds.phase) return 'phase';
  if (serviceIds.project) return 'project';
  return null;
}

/** The only billing method a time entry can be filed against. */
const TIME_ENTRY_BILLING_METHOD = 'hourly';

/** The catalog fields a default-service picker needs. */
export interface TimeEntryServiceChoice {
  service_id: string;
  service_name: string;
  billing_method?: string | null;
}

/**
 * Whether a time entry can be filed against this service. The time entry form's
 * own picker is hourly-only (`fetchServicesForTimeEntry`), so anything else is
 * useless as a default: it would prefill a value that form refuses to save.
 */
export function isTimeEntryService(service: TimeEntryServiceChoice | null | undefined): boolean {
  return service?.billing_method === TIME_ENTRY_BILLING_METHOD;
}

/**
 * Catalog entries a task/phase/project may set as its default service. A value
 * already stored on the row stays listed even when ineligible, so it remains
 * visible and clearable instead of silently sticking around.
 */
export function timeEntryServiceChoices<T extends TimeEntryServiceChoice>(
  services: readonly T[],
  selectedServiceId?: string | null,
): T[] {
  return services.filter(
    (service) => isTimeEntryService(service) || (!!selectedServiceId && service.service_id === selectedServiceId),
  );
}
