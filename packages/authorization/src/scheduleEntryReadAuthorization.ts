import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  bundleRulesRestrict,
  clientResolvers,
  compileResourceReadAuthorizationSql,
  createAuthorizationKernel,
  polymorphicClientsHook,
  type AuthorizationSubject,
  type BundleNarrowingRule,
  type RelationshipSqlAdapter,
} from './kernel';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';
import { resolveAuthorizationSubject } from './subject/resolver';
import type { SubjectUserInput } from './subject/assemble';

/**
 * Read authorization for the `schedule_entry` resource.
 *
 * A schedule entry has no client column: its client is the client of the work item it points at
 * (tenant manifest: `clientKeyed: { by: 'resolver', resolver: 'work_item' }`). Whether a reader may read an
 * entry is therefore decided by the client scope of their policy, applied to that resolved client:
 *
 *   - Row facet (one entry): `clientResolvers.resolveClient('work_item', type, id)` gives the client, and the
 *     kernel decides on `{ type: 'schedule_entry', action: 'read' }` with that client.
 *   - SQL facet (a list): `polymorphicClientsHook('schedule_entries', alias)` narrows the query.
 *
 * Rules for `schedule_entry:read` are the reader's `ticket:read` rules re-labelled, reduced to the
 * client-scope templates (same_client, client_portfolio, selected_clients): an entry has no board, owner or
 * assignment fields that ticket templates could test, and field redactions and constraints describe the ticket.
 * A rule that names `schedule_entry` directly applies as written. A closed bundle that names neither denies.
 *
 * Entries with no client BY DESIGN are internal calendar items, not client-owned records, and are never
 * narrowed: an entry with no work item, or of type `ad_hoc` / `non_billable_category`. (The PRD treats a null
 * client as "every client" only for template records; calendar items such as leave, meetings and admin time are
 * normal and must stay readable for a restricted user.) An entry whose work item IS client-owned but cannot be
 * resolved to a client (deleted record, another tenant's id, a null-client ticket) or whose type nobody
 * registered resolves to no client and FAILS CLOSED: it is not readable.
 *
 * A reader with no restriction reads everything, and costs no query: see `restricted`.
 */

const CLIENT_SCOPE_TEMPLATES = new Set(['same_client', 'client_portfolio', 'selected_clients']);

/** work_item_type values that are not client-owned by design. */
export const CLIENTLESS_WORK_ITEM_TYPES: readonly string[] = ['ad_hoc', 'non_billable_category'];

export interface ScheduleEntryRef {
  entry_id: string;
  work_item_id?: string | null;
  work_item_type?: string | null;
}

export interface ScheduleEntryReadScope {
  tenant: string;
  subject: AuthorizationSubject;
  rules: BundleNarrowingRule[];
  /** False when the reader's policy does not restrict schedule entries: every entry is readable, no query is needed. */
  restricted: boolean;
  requestCache: RequestLocalAuthorizationCache;
}

/** The `schedule_entry:read` rule set derived from the reader's assigned rules (see module doc). */
export function scheduleEntryReadRules(rules: readonly BundleNarrowingRule[]): BundleNarrowingRule[] {
  return rules.map((rule) => {
    if (rule.resource !== 'ticket' || rule.action !== 'read') return rule;
    return {
      ...rule,
      resource: 'schedule_entry',
      templateKey: rule.templateKey && CLIENT_SCOPE_TEMPLATES.has(rule.templateKey) ? rule.templateKey : null,
      constraintKey: null,
      constraints: undefined,
      redactedFields: undefined,
    };
  });
}

export async function createScheduleEntryReadScope(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  /** Share one cache across the request so the tenant fast-path probe runs once. */
  requestCache: RequestLocalAuthorizationCache = new RequestLocalAuthorizationCache()
): Promise<ScheduleEntryReadScope> {
  const subject = await resolveAuthorizationSubject(trx, { tenant, user, requestCache });
  const assigned = await resolveBundleNarrowingRulesForEvaluation(trx, {
    subject,
    resource: { type: 'schedule_entry', action: 'read' },
    requestCache,
    knex: trx,
  });
  const rules = scheduleEntryReadRules(assigned);
  return {
    tenant,
    subject,
    rules,
    restricted: bundleRulesRestrict(rules, 'schedule_entry', 'read'),
    requestCache,
  };
}

function isClientlessByDesign(entry: ScheduleEntryRef): boolean {
  return !entry.work_item_type || CLIENTLESS_WORK_ITEM_TYPES.includes(entry.work_item_type);
}

function scheduleEntrySqlAdapter(alias: string): RelationshipSqlAdapter {
  return {
    applyAssignedUsers(builder, userIds) {
      const ids = Array.from(new Set(userIds.filter((value) => typeof value === 'string' && value.length > 0)));
      if (ids.length === 0) {
        builder.whereRaw('1 = 0');
        return;
      }
      builder.whereExists(function assignedTo(this: Knex.QueryBuilder) {
        this.select(this.client.raw('1'))
          .from('schedule_entry_assignees as sea')
          .whereRaw('sea.tenant = ??', [`${alias}.tenant`])
          .whereRaw('sea.entry_id = ??', [`${alias}.entry_id`])
          .whereIn('sea.user_id', ids);
      });
    },
    applyClients: polymorphicClientsHook('schedule_entries', alias),
  };
}

/**
 * Ids of the given entries the reader may NOT read, decided in SQL with the S4 client narrowing. Costs nothing
 * for an unrestricted reader or an empty list; for a restricted reader it reads the STORED work item of each
 * entry (never the caller's view of it, which may already be masked or projected), then one narrowed query.
 * An id with no stored entry is unreadable.
 */
export async function unreadableScheduleEntryIds(
  trx: Knex | Knex.Transaction,
  scope: ScheduleEntryReadScope,
  entryIds: readonly string[]
): Promise<Set<string>> {
  if (!scope.restricted || entryIds.length === 0) return new Set();

  const ids = [...new Set(entryIds)];
  const stored = (await tenantDb(trx, scope.tenant)
    .scoped('schedule_entries as se')
    .builder.whereIn('se.entry_id', ids)
    .select('se.entry_id', 'se.work_item_id', 'se.work_item_type')) as ScheduleEntryRef[];
  const storedIds = new Set(stored.map((row) => row.entry_id));
  const unreadable = new Set(ids.filter((id) => !storedIds.has(id)));

  const candidates = stored.filter((entry) => !isClientlessByDesign(entry));
  if (candidates.length === 0) return unreadable;

  // One entry is decided by the row facet; a list by the SQL facet.
  if (candidates.length === 1) {
    if (!(await isScheduleEntryReadable(trx, scope, candidates[0]))) unreadable.add(candidates[0].entry_id);
    return unreadable;
  }

  const alias = 'se';
  const readable = tenantDb(trx, scope.tenant).scoped(`schedule_entries as ${alias}`);
  readable.builder.whereIn(`${alias}.entry_id`, candidates.map((entry) => entry.entry_id));
  const compiled = compileResourceReadAuthorizationSql(readable.builder, {
    resourceType: 'schedule_entry',
    action: 'read',
    builtinRules: [],
    bundleRules: scope.rules,
    ctx: { subject: scope.subject, adapter: scheduleEntrySqlAdapter(alias) },
  });

  if (!compiled.supported) {
    // The SQL compiler cannot express this policy: decide each entry with the row facet.
    const decisions = await Promise.all(candidates.map((entry) => isScheduleEntryReadable(trx, scope, entry)));
    candidates.filter((_, index) => !decisions[index]).forEach((entry) => unreadable.add(entry.entry_id));
    return unreadable;
  }

  const rows = (await readable.builder.select(`${alias}.entry_id`)) as Array<{ entry_id: string }>;
  const readableIds = new Set(rows.map((row) => row.entry_id));
  candidates.filter((entry) => !readableIds.has(entry.entry_id)).forEach((entry) => unreadable.add(entry.entry_id));
  return unreadable;
}

/** Row facet: may the reader read this one entry? Uses the S4 row resolver for the entry's client. */
export async function isScheduleEntryReadable(
  trx: Knex | Knex.Transaction,
  scope: ScheduleEntryReadScope,
  entry: ScheduleEntryRef
): Promise<boolean> {
  if (!scope.restricted || isClientlessByDesign(entry)) return true;

  const clientId = entry.work_item_id
    ? await clientResolvers.resolveClient(trx, scope.tenant, 'work_item', entry.work_item_type as string, entry.work_item_id)
    : null;
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: async () => scope.rules }),
    rbacEvaluator: async () => true,
  });
  const decision = await kernel.authorizeResource({
    subject: scope.subject,
    resource: { type: 'schedule_entry', action: 'read', id: entry.entry_id },
    record: { id: entry.entry_id, clientId },
    requestCache: scope.requestCache,
    knex: trx as Knex,
  });
  return decision.allowed;
}
