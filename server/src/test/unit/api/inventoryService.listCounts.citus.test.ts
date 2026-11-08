/**
 * SQL-shape test (no DB): listCounts' count_lines aggregate must select, group
 * and join on `tenant` so Citus keeps the join on one shard. Uses a stub knex
 * client that records the SQL instead of executing it.
 */
import { describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import { InventoryService } from '../../../lib/api/services/InventoryService';

const TENANT = '11111111-1111-1111-1111-111111111111';

async function captureListCountsSql(): Promise<string> {
  const statements: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PgClient = require('knex/lib/dialects/postgres');
  class RecordingClient extends PgClient {
    async acquireConnection() { return {}; }
    async releaseConnection() { /* noop */ }
    async _query(_conn: unknown, obj: any) {
      statements.push(obj.sql);
      obj.response = { rows: [], rowCount: 0 };
      return obj;
    }
    processResponse(obj: any) { return obj.response.rows; }
  }
  const knex = knexFactory({ client: RecordingClient as any });
  const service = new InventoryService() as any;
  vi.spyOn(service, 'getDbForContext').mockResolvedValue(knex);
  await service.listCounts({ page: 1, limit: 10 }, { tenant: TENANT });
  await knex.destroy();
  const sql = statements.find((s) => s.includes('count_lines'));
  if (!sql) throw new Error(`no count_lines SQL captured: ${statements.join(' | ')}`);
  return sql;
}

describe('InventoryService.listCounts SQL shape', () => {
  it('selects and groups the count_lines aggregate by tenant and session_id', async () => {
    const sql = await captureListCountsSql();
    expect(sql).toContain('select "tenant", "session_id", count(*) as "line_count" from "count_lines"');
    expect(sql).toContain('group by "tenant", "session_id"');
  });

  it('joins the aggregate on tenant as well as session_id', async () => {
    const sql = await captureListCountsSql();
    expect(sql).toContain('"cl"."session_id" = "cs"."session_id"');
    expect(sql).toContain('"cl"."tenant" = "cs"."tenant"');
  });
});
