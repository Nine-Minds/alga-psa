import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  compileResourceReadAuthorizationSql,
  createAuthorizationKernel,
  type AuthorizationSubject,
  type BundleNarrowingRule,
  type RelationshipRule,
  type RelationshipSqlAdapter,
  type RelationshipSqlCompileResult,
} from './kernel';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';
import { resolveAuthorizationSubject } from './subject/resolver';
import type { ContactVisibilityContext } from './portal/visibility';
import { projectReadableRecord } from './recordProjection';
import { resolveClientVisibility, toTicketAuthorizationRecord } from './ticketRecordAuthorization';

/**
 * Ticket read narrowing for lookups and searches that live below the tickets package
 * (scheduling's work item search and ticket lookup cannot import `@alga-psa/tickets`).
 *
 * It is the same policy `optimizedTicketActions` applies to the ticket list: the SQL
 * compiler narrows the query so counts and pages are already in scope; a policy the
 * compiler cannot express (field redactions, unsupported constraints) is decided per
 * row by the kernel, and the readable ids then narrow the query. Rows are never
 * filtered after pagination.
 *
 * Neutral for an unrestricted reader: no rules and no contact visibility compile to no
 * predicate, so the query is unchanged and nothing extra is executed.
 */

// LEVERAGE: pattern ticket-authorization-context — third copy of the subject + rules + kernel assembly
// (optimizedTicketActions.ts, ticketRecordAuthorization.ts); one shared builder would absorb all three.
export interface TicketReadScope {
  tenant: string;
  subject: AuthorizationSubject;
  rules: BundleNarrowingRule[];
  contactVisibility: ContactVisibilityContext | null | undefined;
  selectedBoardIds: string[] | undefined;
  requestCache: RequestLocalAuthorizationCache;
}

export async function createTicketReadScope(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  /** Share one cache across the request so the tenant fast-path probe runs once. */
  requestCache: RequestLocalAuthorizationCache = new RequestLocalAuthorizationCache()
): Promise<TicketReadScope> {
  const subject = await resolveAuthorizationSubject(trx, { tenant, user, requestCache });
  const contactVisibility = await resolveClientVisibility(trx, tenant, user);
  const selectedBoardIds = contactVisibility === null ? [] : contactVisibility?.visibleBoardIds ?? undefined;
  const rules = await resolveBundleNarrowingRulesForEvaluation(trx, {
    subject,
    resource: { type: 'ticket', action: 'read' },
    selectedBoardIds,
    contactVisibility,
    requestCache,
    knex: trx,
  });
  return { tenant, subject, rules, contactVisibility, selectedBoardIds, requestCache };
}

/** Physical mapping of `tickets` under `alias` for the SQL compiler; "assigned" is the primary assignee only. */
// LEVERAGE: pattern ticket-sql-adapter — same mapping as createTicketRelationshipSqlAdapter in packages/tickets/src/lib/ticketAuthorizationSql.ts, which this package cannot import.
function ticketSqlAdapter(alias: string): RelationshipSqlAdapter {
  return {
    ownerColumn: `${alias}.entered_by`,
    clientColumn: `${alias}.client_id`,
    boardColumn: `${alias}.board_id`,
    contactColumn: `${alias}.contact_name_id`,
    billingProfileColumn: `${alias}.billing_profile_id`,
    watchListColumn: `${alias}.attributes`,
    teamColumn: `${alias}.assigned_team_id`,
    applyAssignedUsers(query, userIds) {
      const ids = Array.from(new Set(userIds.filter((value) => typeof value === 'string' && value.length > 0)));
      if (ids.length === 0) query.whereRaw('1 = 0');
      else query.whereIn(`${alias}.assigned_to`, ids);
    },
  };
}

function compileTicketReadSql(
  builder: Knex.QueryBuilder,
  scope: TicketReadScope,
  alias: string
): RelationshipSqlCompileResult {
  // SQL narrowing has no per-row redaction metadata; a redacting policy takes the kernel path.
  if (scope.rules.some((rule) => (rule.redactedFields?.length ?? 0) > 0)) {
    return { supported: false, reason: 'bundle rule redacts fields' };
  }
  const builtinRules: RelationshipRule[] =
    scope.contactVisibility === undefined ? [] : [{ template: 'contact_visibility' }];
  return compileResourceReadAuthorizationSql(builder, {
    resourceType: 'ticket',
    action: 'read',
    builtinRules,
    bundleRules: scope.rules,
    ctx: {
      subject: scope.subject,
      selectedBoardIds: scope.selectedBoardIds,
      contactVisibility: scope.contactVisibility,
      adapter: ticketSqlAdapter(alias),
    },
  });
}

/** Per-row kernel decisions for ticket rows (must carry the authorization columns); the readable ones, projected. */
async function readableTicketRows<T extends Record<string, any>>(
  trx: Knex | Knex.Transaction,
  scope: TicketReadScope,
  rows: T[]
): Promise<T[]> {
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      relationshipRules: scope.contactVisibility === undefined ? [] : [{ template: 'contact_visibility' }],
    }),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: async () => scope.rules }),
    rbacEvaluator: async () => true,
  });
  const decisions = await Promise.all(
    rows.map((row) =>
      row.ticket_id
        ? kernel.authorizeResource({
            subject: scope.subject,
            resource: { type: 'ticket', action: 'read', id: row.ticket_id },
            record: toTicketAuthorizationRecord(row),
            selectedBoardIds: scope.selectedBoardIds,
            contactVisibility: scope.contactVisibility,
            requestCache: scope.requestCache,
            knex: trx,
          })
        : Promise.resolve({ allowed: false, redactedFields: [] as string[] })
    )
  );
  return rows.flatMap((row, index) => {
    const decision = decisions[index];
    if (!decision?.allowed) return [];
    const projected = projectReadableRecord('ticket', row, decision.redactedFields ?? []);
    return projected ? [row] : [];
  });
}

/**
 * Narrow `builder` (a tenant-scoped query over `tickets as <alias>`) to the tickets the reader may read.
 * Applied before count and pagination. Only an inexpressible policy takes the per-row path, and that path decides
 * ONLY the caller's own candidate rows: the caller's query (filters and joins as built so far) with limit, offset,
 * order and select cleared. The readable ids then narrow the original query, so counts and pages stay correct.
 */
export async function narrowTicketQueryToReadable(
  trx: Knex | Knex.Transaction,
  scope: TicketReadScope,
  builder: Knex.QueryBuilder,
  alias = 't'
): Promise<void> {
  const probe = tenantDb(trx, scope.tenant).scoped(`tickets as ${alias}`);
  if (compileTicketReadSql(probe.builder, scope, alias).supported) {
    compileTicketReadSql(builder, scope, alias);
    return;
  }

  const candidates = (await builder
    .clone()
    .clearSelect()
    .clearOrder()
    .clear('limit')
    .clear('offset')
    .distinctOn(`${alias}.ticket_id`)
    .select(
      `${alias}.ticket_id`,
      `${alias}.assigned_to`,
      `${alias}.entered_by`,
      `${alias}.client_id`,
      `${alias}.board_id`,
      `${alias}.assigned_team_id`,
      `${alias}.contact_name_id`,
      `${alias}.billing_profile_id`,
      `${alias}.attributes`
    )) as Array<Record<string, any>>;
  const readable = await readableTicketRows(trx, scope, candidates);
  if (readable.length === 0) builder.whereRaw('1 = 0');
  else builder.whereIn(`${alias}.ticket_id`, readable.map((row) => row.ticket_id));
}

/** The subset of `ticketIds` the reader may read. One narrowed query; empty input costs nothing. */
export async function readableTicketIds(
  trx: Knex | Knex.Transaction,
  scope: TicketReadScope,
  ticketIds: readonly string[]
): Promise<Set<string>> {
  if (ticketIds.length === 0) return new Set();
  const query = tenantDb(trx, scope.tenant).scoped('tickets as t');
  query.builder.whereIn('t.ticket_id', [...ticketIds]);
  await narrowTicketQueryToReadable(trx, scope, query.builder, 't');
  const rows = (await query.builder.select('t.ticket_id')) as Array<{ ticket_id: string }>;
  return new Set(rows.map((row) => row.ticket_id));
}
