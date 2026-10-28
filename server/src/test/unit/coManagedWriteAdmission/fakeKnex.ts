import knexFactory, { type Knex } from 'knex';
import { createCoManagedWriteAdmissionResolver } from '@alga-psa/licensing/co-managed-write-admission';
import {
  clearWriteAdmissionCacheForTests,
  withTestWriteAdmission,
} from '@alga-psa/db/testing';

/** The tenant the fake database reports as `product_code = 'co_managed'`. */
export const CO_MANAGED_TENANT = '10000000-0000-4000-8000-000000000001';
export const PSA_TENANT = 'tenant-psa';

export interface FakeKnex {
  knex: Knex;
  /** Every statement the fake database received, in order. */
  statements: string[];
  /** Statements that are neither the admission lookup nor transaction control. */
  writes(): string[];
  destroy(): Promise<void>;
}

type Responder = (sql: string, bindings: readonly unknown[]) => Record<string, unknown>[] | undefined;

/**
 * A pg-dialect knex whose driver is a recorder. Reads answer `responder` (default
 * none); the admission lookup answers from `product_code`. No database needed.
 */
export function createFakeKnex(responder: Responder = () => undefined): FakeKnex {
  const statements: string[] = [];
  const knex = knexFactory({ client: 'pg' });
  const client = knex.client as any;
  // Transactions talk to the connection directly, so fake the connection (pg's
  // `query(config, callback)`), not Client._query.
  const connection = {
    __knexUid: 'fake',
    query(config: any, callback: (err: unknown, res?: unknown) => void) {
      const sql: string = typeof config === 'string' ? config : config.text;
      const bindings: readonly unknown[] = typeof config === 'string' ? [] : config.values ?? [];
      statements.push(sql);
      let rows: Record<string, unknown>[] = [];
      if (/from "tenants"/.test(sql) && /product_code/.test(sql)) {
        rows = [{ product_code: bindings[0] === CO_MANAGED_TENANT ? 'co_managed' : 'psa' }];
      } else {
        rows = responder(sql, bindings) ?? [];
      }
      queueMicrotask(() => callback(null, { rows, rowCount: rows.length, command: 'SELECT', fields: [] }));
    },
  };
  client.acquireConnection = async () => connection;
  client.releaseConnection = async () => {};
  const isNoise = (s: string) => /^(begin|commit|rollback|savepoint|release)/i.test(s) || (/from "tenants"/.test(s) && /product_code/.test(s));
  return {
    knex,
    statements,
    writes: () => statements.filter((s) => /^\s*(insert|update|delete|truncate)/i.test(s) && !isNoise(s)),
    destroy: () => knex.destroy(),
  };
}

/** Run `work` with the real co-managed resolver installed over a read-only lifecycle. */
export function withReadOnlyWorkspace<T>(work: () => Promise<T>, state: 'read_only' | 'terminated' | 'pending_acceptance' = 'read_only'): Promise<T> {
  const resolver = createCoManagedWriteAdmissionResolver(async () => ({ state, canWrite: false, graceEndsAt: null }));
  return withTestWriteAdmission(resolver, work);
}

export { clearWriteAdmissionCacheForTests };
