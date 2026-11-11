import type { Knex } from 'knex';
import { tenantDb, type TenantDb } from '@alga-psa/db';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';
import { resolveReportClientScope } from './reportClientScope';
import { ClientScopeRefusedError } from './refusal';

/**
 * A tenant-scoped db handle for a hand-written report: every query it starts is narrowed to the subject's clients.
 *
 * `table()` and `subquery()` narrow the ROOT table of each query through its ownership declaration (a client-owned
 * root gets the client predicate; a root listed in `passthrough` is report configuration and is left alone; any other
 * root throws `ClientScopeRefusedError`, which the report action turns into a catalogued refusal). Joins decorate rows
 * the root already admitted. The escape hatches that start a query without a root check (`unscoped`, `scoped`,
 * `parentScopedTable`) refuse for a narrowed subject.
 *
 * A subject nothing narrows gets the plain `tenantDb` handle back, untouched, after one cached probe.
 */
export async function clientScopedTenantDb(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  options: { reportId: string; passthrough?: readonly string[] }
): Promise<TenantDb> {
  const db = tenantDb(conn, tenant);
  const scope = await resolveReportClientScope(conn, { tenant, user });
  if (!scope.narrowed) return db;

  const narrowRoot = <B extends Knex.QueryBuilder>(builder: B, tableExpression: string): B => {
    const result = scope.narrowTable(builder, tableExpression, options.passthrough);
    if (!result.ok) throw new ClientScopeRefusedError({ ...result.refusal, reportId: options.reportId });
    return builder;
  };
  const refuseEscapeHatch = (name: string): never => {
    throw new ClientScopeRefusedError({
      code: 'not_client_attributable',
      reportId: options.reportId,
      reason: `${name} starts a query without a client-owned root, which cannot be limited to a set of clients`,
    });
  };

  return new Proxy(db, {
    get(target, property, receiver) {
      switch (property) {
        case 'table':
          return (tableExpression: string) => narrowRoot(target.table(tableExpression), tableExpression);
        case 'subquery':
          return (tableExpression: string) => narrowRoot(target.subquery(tableExpression), tableExpression);
        case 'unscoped':
        case 'scoped':
        case 'parentScopedTable':
        case 'insertParentScoped':
          return () => refuseEscapeHatch(String(property));
        default: {
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      }
    },
  });
}
