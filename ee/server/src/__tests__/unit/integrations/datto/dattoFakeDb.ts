/**
 * Minimal in-memory stand-in for the knex surface the Datto sync modules use
 * (tenantDb(conn, tenant).table(name) -> chainable query builder). Not a SQL
 * engine: it supports exactly the where/insert/update/onConflict shapes the
 * sync code issues, so a test fails loudly if the code starts using more.
 */
export type Row = Record<string, any>;

export function createFakeDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: 'insert' | 'update'; row: Row }> = [];

  class QB {
    private filters: Array<(r: Row) => boolean> = [];
    constructor(private readonly table: string) {}

    where(a: Row | string, b?: any) {
      if (typeof a === 'string') this.filters.push((r) => r[a] === b);
      else this.filters.push((r) => Object.entries(a).every(([k, v]) => r[k] === v));
      return this;
    }
    andWhere(col: string, val: any) {
      return this.where(col, val);
    }
    whereNotNull(col: string) {
      this.filters.push((r) => r[col] !== null && typeof r[col] !== 'undefined');
      return this;
    }
    whereNull(col: string) {
      this.filters.push((r) => r[col] === null || typeof r[col] === 'undefined');
      return this;
    }
    // Only the `lower(col) = ?` shape the client-name lookup issues.
    whereRaw(sql: string, bindings: any[]) {
      const match = /^lower\((\w+)\) = \?$/.exec(sql.trim());
      if (!match) throw new Error(`fake db: unsupported whereRaw ${sql}`);
      const col = match[1]!;
      this.filters.push((r) => String(r[col] ?? '').toLowerCase() === bindings[0]);
      return this;
    }
    private limitCount: number | null = null;
    limit(count: number) {
      this.limitCount = count;
      return this;
    }
    whereIn(col: string, values: any[]) {
      const set = values.map((v) => String(v));
      this.filters.push((r) => set.includes(String(r[col])));
      return this;
    }
    private rows() {
      return (tables[this.table] ??= []).filter((r) => this.filters.every((f) => f(r)));
    }
    private project(row: Row, cols?: string[] | string) {
      const list = typeof cols === 'string' ? [cols] : cols;
      if (!list?.length) return { ...row };
      return Object.fromEntries(list.map((c) => [c, row[c]]));
    }
    then(resolve: any, reject: any) {
      return Promise.resolve(this.rows().map((r) => ({ ...r }))).then(resolve, reject);
    }
    async select(cols?: string[] | string) {
      const rows = this.rows().map((r) => this.project(r, cols));
      return this.limitCount === null ? rows : rows.slice(0, this.limitCount);
    }
    async first(cols?: string[] | string) {
      const row = this.rows()[0];
      return row ? this.project(row, cols) : undefined;
    }
    async update(patch: Row) {
      const rows = this.rows();
      for (const r of rows) {
        // knex.raw(`metadata || ?::jsonb`) from the software ingest: merge, don't replace.
        if (patch.metadata?.__merge) r.metadata = { ...(r.metadata ?? {}), ...patch.metadata.__merge };
        else Object.assign(r, patch);
      }
      writes.push({ table: this.table, op: 'update', row: patch });
      return rows.length;
    }
    insert(row: Row) {
      const table = this.table;
      const list = (tables[table] ??= []);
      let conflictCols: string[] | null = null;
      let mergePatch: Row | null = null;
      const apply = () => {
        writes.push({ table: this.table, op: 'insert', row });
        if (conflictCols) {
          const existing = list.find((r) => conflictCols!.every((c) => r[c] === row[c]));
          if (existing) {
            Object.assign(existing, mergePatch ?? {});
            return;
          }
        }
        list.push({ ...row });
      };
      const builder: any = {
        onConflict(cols: string[]) {
          conflictCols = cols;
          return {
            merge: async (patch: Row) => {
              mergePatch = patch;
              apply();
            },
          };
        },
        then(resolve: any, reject: any) {
          apply();
          return Promise.resolve([]).then(resolve, reject);
        },
        // insert(...).returning(cols): stored row gets a generated id column.
        // returning('*') echoes the whole row, with the table's own id column.
        async returning(cols: string[] | string) {
          const list2 = typeof cols === 'string' ? [cols] : cols;
          const all = list2.includes('*');
          const idCol = all
            ? `${table.replace(/s$/, '')}_id`
            : list2.find((c) => c.endsWith('_id'));
          if (idCol && row[idCol] == null) row[idCol] = `${idCol.replace(/_id$/, '')}-${list.length + 1}`;
          apply();
          return [all ? { ...row } : Object.fromEntries(list2.map((c) => [c, row[c]]))];
        },
      };
      return builder;
    }
  }

  const knex: any = { fn: { now: () => new Date('2026-10-19T12:00:00.000Z') } };
  knex.raw = (_sql: string, bindings: string[]) => ({ __merge: JSON.parse(bindings[0]) });
  knex.__table = (t: string) => new QB(t);
  return { knex, tables, writes };
}

export const TENANT = 'tenant_1';
export const INTEGRATION_ID = 'integration_1';

/** rmm_integrations / rmm_organization_mappings rows for a tenant with three sites. */
export function seedDattoTables(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    rmm_integrations: [
      { integration_id: INTEGRATION_ID, provider: 'datto', is_active: true, settings: {}, tenant: TENANT },
    ],
    rmm_organization_mappings: [
      // Mapped and auto-sync on: the only one a full sync should visit.
      { integration_id: INTEGRATION_ID, external_organization_id: 'site-a', client_id: 'client-a', auto_sync_assets: true },
      // Mapped but auto-sync off.
      { integration_id: INTEGRATION_ID, external_organization_id: 'site-b', client_id: 'client-b', auto_sync_assets: false },
      // Auto-sync on but no client yet.
      { integration_id: INTEGRATION_ID, external_organization_id: 'site-c', client_id: null, auto_sync_assets: true },
    ],
    tenant_external_entity_mappings: [],
    assets: [],
    ...extra,
  };
}

/** A DattoRmmClient stand-in: devices are served one page per array entry. */
export function createFakeDattoClient(pagesBySite: Record<string, any[][]>, audits: Record<string, any> = {}) {
  const pageCalls: string[] = [];
  const client: any = {
    requestCount: 0,
    pageSiteDevices: (siteUid: string) => {
      pageCalls.push(siteUid);
      return (async function* () {
        for (const page of pagesBySite[siteUid] ?? []) {
          client.requestCount += 1;
          yield page;
        }
      })();
    },
    getDeviceAudit: async (uid: string) => {
      client.requestCount += 1;
      const audit = audits[uid];
      if (audit instanceof Error) throw audit;
      return audit ?? {};
    },
    getPrinterAudit: async (uid: string) => {
      client.requestCount += 1;
      const audit = audits[uid];
      if (audit instanceof Error) throw audit;
      return audit ?? {};
    },
    // Account-wide listing: every site's pages, in key order, unless overridden.
    accountPages: null as any[][] | null,
    accountListingError: null as Error | null,
    pageAccountDevices: () => {
      pageCalls.push('<account>');
      return (async function* () {
        if (client.accountListingError) throw client.accountListingError;
        const pages = client.accountPages ?? Object.values(pagesBySite).flat();
        for (const page of pages) {
          client.requestCount += 1;
          yield page;
        }
      })();
    },
    getEsxiHostAudit: async (uid: string) => {
      client.requestCount += 1;
      const audit = audits[uid];
      if (audit instanceof Error) throw audit;
      return audit ?? {};
    },
  };
  return { client, pageCalls };
}
