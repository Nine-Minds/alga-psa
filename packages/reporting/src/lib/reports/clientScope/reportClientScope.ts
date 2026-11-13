import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  resolveClientReadScope,
  type ClientReadScope,
} from '@alga-psa/authorization/clientReadScope';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';
import type { AuthorizationRequestCache } from '@alga-psa/authorization/kernel';
import { parseTableExpression } from '@alga-psa/db';
import { classifyTableOwnership, createClientOwnershipAdapter } from './ownershipPredicate';
import type { NarrowingAnchor } from './queryPlan';
import { clientScopeOk, clientScopeRefused, type ClientScopeRefusal, type ClientScopeResult } from './refusal';

/**
 * The client scope a report runs under.
 *
 * Resolved once per report from the subject. A subject nothing narrows (no published bundle assignment in
 * the tenant, or no client rule for them) gets `narrowed: false`, and every method is then a no-op: the one
 * cached tenant probe is the only statement added, so a tenant that does not use bundles pays nothing.
 *
 * The scope answers "which clients may this subject read?" (the `client` resource's rules) and maps it onto
 * each table through that table's ownership declaration. A scope that cannot be resolved throws; it never reads
 * as unrestricted.
 */
export interface ReportClientScope {
  readonly narrowed: boolean;
  /** AND the client predicate for every anchor onto `builder`. */
  narrowAnchors(builder: Knex.QueryBuilder, anchors: readonly NarrowingAnchor[]): void;
  /**
   * Narrow a query whose root is `tableExpression` (e.g. `tickets as t`). A client-owned table is narrowed; a table the
   * caller listed in `passthrough` (configuration such as statuses or users, which holds no client data) is left alone;
   * anything else cannot be narrowed and is refused.
   */
  narrowTable(builder: Knex.QueryBuilder, tableExpression: string, passthrough?: readonly string[]): ClientScopeResult<true>;
  /** Whether the one client `clientId` is in scope (for reports that take a client id). */
  permitsClient(conn: Knex | Knex.Transaction, tenant: string, clientId: string): Promise<boolean>;
}

export interface ResolveReportClientScopeInput {
  tenant: string;
  user: SubjectUserInput;
  requestCache?: AuthorizationRequestCache;
}

const NEUTRAL_ADAPTER = { applyAssignedUsers: (builder: Knex.QueryBuilder) => void builder.whereRaw('1 = 0') };

const UNNARROWED: ReportClientScope = Object.freeze({
  narrowed: false,
  narrowAnchors: () => undefined,
  narrowTable: () => clientScopeOk(true as const),
  permitsClient: async () => true,
});

export async function resolveReportClientScope(
  conn: Knex | Knex.Transaction,
  input: ResolveReportClientScopeInput
): Promise<ReportClientScope> {
  const readScope: ClientReadScope = await resolveClientReadScope(conn, {
    tenant: input.tenant,
    user: input.user,
    resourceType: 'client',
    createAdapter: () => NEUTRAL_ADAPTER,
    requestCache: input.requestCache,
  });
  if (!readScope.narrowed) return UNNARROWED;

  const userId = readScope.subject?.userId ?? null;

  const applyOne = (builder: Knex.QueryBuilder, table: string, alias: string) => {
    const adapter = createClientOwnershipAdapter(table, alias, userId);
    // Grouped, so the rule group the compiler adds is ANDed as a unit.
    builder.andWhere(function narrowToScope(this: Knex.QueryBuilder) {
      readScope.applyWith(this, adapter);
    });
  };

  return {
    narrowed: true,
    narrowAnchors(builder, anchors) {
      for (const anchor of anchors) applyOne(builder, anchor.table, anchor.alias);
    },
    narrowTable(builder, tableExpression, passthrough = []) {
      const { tableName, rootAlias } = parseTableExpression(tableExpression);
      // The caller's word comes first: `users` is declared client-owned (client-portal users), but a staff roster
      // read as report configuration is not narrowed by it.
      if (passthrough.includes(tableName)) return clientScopeOk(true as const);
      const kind = classifyTableOwnership(tableName);
      if (kind === 'owned') {
        applyOne(builder, tableName, rootAlias);
        return clientScopeOk(true as const);
      }
      return clientScopeRefused(
        kind === 'undeclared'
          ? {
              code: 'undeclared_table',
              table: tableName,
              reason: `${tableName} has no client-ownership declaration, so there is no way to tell which clients its rows belong to`,
            }
          : {
              code: 'not_client_attributable',
              table: tableName,
              reason: `${tableName} is not attributable to a client`,
            }
      );
    },
    async permitsClient(db, tenant, clientId) {
      const query = tenantDb(db, tenant).table('clients as r').where('r.client_id', clientId);
      applyOne(query, 'clients', 'r');
      return Boolean(await query.first('r.client_id'));
    },
  };
}

/** The refusal for a hand-written report that reads data no client predicate can reach. */
export function notClientAttributable(reportId: string, reason: string, table?: string): ClientScopeRefusal {
  return { code: 'not_client_attributable', reportId, table, reason };
}
