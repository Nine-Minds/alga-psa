import type { Knex } from 'knex';

/**
 * Billing work-context seam (stands in for the L6a1/T0-2 `timeEntryWorkContext` seam, which never reached main).
 *
 * Native ticket / project-task time keeps its own joins (the generated SQL for native-only tenants is
 * untouched). A *contributor* adds work whose `time_entries.work_item_id` does not point at a native
 * ticket or project task: it supplies one row per time entry it owns, in a fixed column contract, and the
 * engine composes it as one extra LEFT JOIN.
 *
 * NEUTRALITY: `activeTimeEntryWorkContributors(tenant)` is the only gate. It returns `[]` (so no SQL
 * changes and no contributor table is named) unless a contributor is registered AND its cached
 * `serves(tenant)` verdict is true. Nothing is registered unless the product loads that feature.
 *
 * Fragment columns (all required, NULL where unknown):
 *   tenant, entry_id, work_item_type, client_id, billing_profile_id, ticket_number, ticket_title,
 *   project_task_name, work_item_name, source_tenant, source_kind, source_id, relationship_id
 */
export interface TimeEntryWorkContributor {
  kind: string;
  /** `time_entries.work_item_type` values this contributor owns. */
  workItemTypes: readonly string[];
  /** Cached per-tenant verdict; must not query in steady state. */
  serves(tenant: string): Promise<boolean>;
  /** One row per owned time entry of `tenant`, in the column contract above. */
  fragment(tenant: string): { sql: string; bindings: unknown[] };
  /** Entry-keyed context for validating a manual (Quick Invoice) source; null when the entry is not this contributor's. */
  describeEntry?(trx: Knex.Transaction, tenant: string, entryId: string): Promise<ContributedEntryContext | null>;
  /** Resolve a user-facing work id (e.g. the shared ticket) to the contributor's time work item. */
  resolveWorkItem?(db: Knex, tenant: string, id: string): Promise<ContributedWorkItem | null>;
}

export interface ContributedWorkItem {
  workItemType: string;
  workItemId: string;
  clientId: string;
  ticketNumber: string | null;
  title: string | null;
}

export interface ContributedEntryContext {
  workItemType: string;
  clientId: string;
  ticketNumber: string | null;
  title: string | null;
  sourceKind: 'ticket' | 'project_task';
  sourceTenant: string;
  sourceId: string;
}

const KEY = Symbol.for('alga.billing.timeEntryWorkContributors');
type Host = typeof globalThis & { [KEY]?: Map<string, TimeEntryWorkContributor> };
const registry: Map<string, TimeEntryWorkContributor> = ((globalThis as Host)[KEY] ??= new Map());

export function registerTimeEntryWorkContributor(contributor: TimeEntryWorkContributor): void {
  if (registry.has(contributor.kind)) throw new Error(`A time-entry work contributor is already registered for '${contributor.kind}'`);
  registry.set(contributor.kind, contributor);
}

/** Test seam. */
export function resetTimeEntryWorkContributorsForTests(): void { registry.clear(); }

export async function activeTimeEntryWorkContributors(tenant: string): Promise<TimeEntryWorkContributor[]> {
  if (registry.size === 0) return [];
  const active: TimeEntryWorkContributor[] = [];
  for (const contributor of registry.values()) if (await contributor.serves(tenant)) active.push(contributor);
  return active;
}

export const CONTRIBUTED_WORK_ALIAS = 'billing_work_ext';

/** Compose the contributors into one LEFT JOIN on the entry; a no-op (returns false) with none. */
export function joinContributedTimeEntryWork(db: Pick<Knex, "raw">, tenant: string, query: Knex.QueryBuilder,
  contributors: readonly TimeEntryWorkContributor[], entryAlias = 'time_entries'): boolean {
  if (contributors.length === 0) return false;
  const parts = contributors.map(c => c.fragment(tenant));
  const raw = db.raw(`(${parts.map(p => p.sql).join(' UNION ALL ')}) AS ${CONTRIBUTED_WORK_ALIAS}`, parts.flatMap(p => p.bindings) as any);
  query.leftJoin(raw, function () {
    this.on(`${CONTRIBUTED_WORK_ALIAS}.tenant`, '=', `${entryAlias}.tenant`)
      .andOn(`${CONTRIBUTED_WORK_ALIAS}.entry_id`, '=', `${entryAlias}.entry_id`);
  });
  return true;
}

export async function describeContributedEntry(trx: Knex.Transaction, tenant: string, entryId: string): Promise<{ contributor: TimeEntryWorkContributor; context: ContributedEntryContext } | null> {
  for (const contributor of await activeTimeEntryWorkContributors(tenant)) {
    const context = await contributor.describeEntry?.(trx, tenant, entryId);
    if (context) return { contributor, context };
  }
  return null;
}

export async function resolveContributedWorkItem(db: Knex, tenant: string, id: string): Promise<ContributedWorkItem | null> {
  for (const contributor of await activeTimeEntryWorkContributors(tenant)) {
    const item = await contributor.resolveWorkItem?.(db, tenant, id);
    if (item) return item;
  }
  return null;
}
