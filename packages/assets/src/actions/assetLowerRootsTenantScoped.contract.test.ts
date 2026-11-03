import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};

  const columnValue = (record: Record<string, Row>, column: string, root: string) => {
    const [table, field] = column.includes('.') ? column.split('.', 2) : [root, column];
    return record[table]?.[field];
  };

  const makeQuery = (table: string, tenant: string) => {
    const joins: Array<{ table: string; left: string; right: string }> = [];
    const filters: Array<{ column: string; value: unknown }> = [];
    let selection: string[] = [];
    let countRequested = false;

    const records = () => {
      let joined = (tables[table] ?? [])
        .filter((row) => row.tenant === tenant)
        .map((row) => ({ [table]: row }));

      for (const join of joins) {
        joined = joined.flatMap((record) => (tables[join.table] ?? [])
          .filter((row) => {
            const combined = { ...record, [join.table]: row };
            return row.tenant === tenant && columnValue(combined, join.left, table) === columnValue(combined, join.right, table);
          })
          .map((row) => ({ ...record, [join.table]: row })));
      }

      return joined.filter((record) => filters.every(({ column, value }) => columnValue(record, column, table) === value));
    };

    const project = (record: Record<string, Row>) => {
      if (selection.length === 0) return Object.assign({}, ...Object.values(record));
      const output: Row = {};
      for (const expression of selection) {
        const [column, alias] = expression.split(/\s+as\s+/i);
        if (column.endsWith('.*')) {
          Object.assign(output, record[column.slice(0, -2)]);
          continue;
        }
        const field = column.split('.').at(-1)!;
        output[alias ?? field] = columnValue(record, column, table);
      }
      return output;
    };

    const query: any = {
      where(columnOrFields: string | Record<string, unknown>, value?: unknown) {
        if (typeof columnOrFields === 'string') filters.push({ column: columnOrFields, value });
        else for (const [column, fieldValue] of Object.entries(columnOrFields)) filters.push({ column, value: fieldValue });
        return query;
      },
      addTenantJoin(joinedTable: string, left: string, right: string) {
        joins.push({ table: joinedTable, left, right });
        return query;
      },
      select(...columns: string[]) {
        selection = columns;
        return query;
      },
      count() {
        countRequested = true;
        return query;
      },
      async first() {
        const resultRows = records();
        if (countRequested) return { count: String(resultRows.length) };
        return resultRows[0] ? project(resultRows[0]) : undefined;
      },
      then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve(records().map(project)).then(resolve, reject);
      },
      catch(reject: (error: unknown) => unknown) {
        return Promise.resolve(records().map(project)).catch(reject);
      },
    };
    return query;
  };

  return {
    tables,
    reset() {
      for (const key of Object.keys(tables)) delete tables[key];
      tables.assets = [
        { tenant: 'tenant-a', asset_id: 'shared-asset', asset_type: 'workstation', agent_status: 'online', last_seen_at: null, warranty_end_date: '2099-01-01' },
        { tenant: 'tenant-b', asset_id: 'shared-asset', asset_type: 'workstation', agent_status: 'offline', last_seen_at: '2000-01-01', warranty_end_date: '2001-01-01' },
      ];
      tables.workstation_assets = [
        { tenant: 'tenant-a', asset_id: 'shared-asset', antivirus_status: 'healthy', antivirus_product: 'Tenant A AV' },
        { tenant: 'tenant-b', asset_id: 'shared-asset', antivirus_status: 'at_risk', antivirus_product: 'Tenant B AV' },
      ];
      tables.asset_associations = [
        { tenant: 'tenant-a', asset_id: 'shared-asset', entity_type: 'ticket', entity_id: 'shared-ticket' },
        { tenant: 'tenant-b', asset_id: 'shared-asset', entity_type: 'ticket', entity_id: 'shared-ticket' },
      ];
      tables.tickets = [
        { tenant: 'tenant-a', ticket_id: 'shared-ticket', status_id: 'shared-status', title: 'Tenant A ticket' },
        { tenant: 'tenant-b', ticket_id: 'shared-ticket', status_id: 'shared-status', title: 'Tenant B secret ticket' },
      ];
      tables.statuses = [
        { tenant: 'tenant-a', status_id: 'shared-status', is_closed: false },
        { tenant: 'tenant-b', status_id: 'shared-status', is_closed: true },
      ];
    },
    tenantDb(_knex: unknown, tenant: string) {
      return {
        table(tableExpression: string) {
          return makeQuery(tableExpression.split(' as ')[0], tenant);
        },
        tenantJoin(query: any, tableExpression: string, left: string, right: string) {
          query.addTenantJoin(tableExpression.split(' as ')[0], left, right);
          return query;
        },
      };
    },
  };
});

vi.mock('@alga-psa/db', () => ({ tenantDb: h.tenantDb }));

import { countOpenAssetTickets, loadAssetSummaryFacts, loadAssetSummaryTickets } from '../lib/assetSummary';

describe('asset summary tenant isolation', () => {
  beforeEach(() => h.reset());

  it('loads summary facts only from the requested tenant when asset ids overlap', async () => {
    const facts = await loadAssetSummaryFacts({} as any, 'tenant-a', 'shared-asset');

    expect(facts.asset.agent_status).toBe('online');
    expect(facts.extensionData?.antivirus_product).toBe('Tenant A AV');
    expect(JSON.stringify(facts)).not.toContain('Tenant B');
  });

  it('joins and counts only same-tenant asset tickets and statuses', async () => {
    const tickets = await loadAssetSummaryTickets({} as any, 'tenant-a', 'shared-asset');
    const count = await countOpenAssetTickets({} as any, 'tenant-a', 'shared-asset');

    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ ticket_id: 'shared-ticket', title: 'Tenant A ticket', status_is_closed: false });
    expect(JSON.stringify(tickets)).not.toContain('Tenant B');
    expect(count).toBe(1);
  });
});
