import { describe, expect, it, vi } from 'vitest';
const migration = require('../../../../migrations/20260926100000_add_outbound_email_senders.cjs');

describe('multiple outbound sender migration', () => {
  it('backfills ticket From address and name, including name-only routes', async () => {
    const statements: string[] = [];
    let table: any;
    table = new Proxy({}, { get: () => (..._args: unknown[]) => table });
    const knex: any = {
      schema: { createTable: vi.fn(async (_name: string, callback: (builder: any) => void) => callback(table)), dropTableIfExists: vi.fn() },
      fn: { now: vi.fn(() => 'now()') },
      raw: vi.fn(async (sql: string) => { statements.push(sql); return { rows: [] }; }),
    };

    await migration.up(knex);
    const senderBackfill = statements.find((sql) => sql.includes('INSERT INTO email_sender_addresses')) ?? '';
    const routeBackfill = statements.find((sql) => sql.includes('INSERT INTO email_sender_routes')) ?? '';

    expect(senderBackfill).toContain('lower(trim(tes.ticketing_from_email))');
    expect(senderBackfill).toContain('coalesce(nullif(trim(tes.ticketing_from_name), \'\'), nullif(trim(ep.sender_display_name), \'\'))');
    expect(senderBackfill).toContain("ep.provider_type = 'microsoft'");
    expect(routeBackfill).toContain("'mail_class', 'ticket'");
    expect(routeBackfill).toContain('nullif(trim(tes.ticketing_from_name), \'\')');
    expect(routeBackfill).toContain('WHERE nullif(trim(tes.ticketing_from_email), \'\') IS NOT NULL');
    expect(routeBackfill).toContain('OR nullif(trim(tes.ticketing_from_name), \'\') IS NOT NULL');
  });
});
