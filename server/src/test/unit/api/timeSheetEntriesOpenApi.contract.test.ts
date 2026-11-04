import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

// A real `time_entries.*` row as node-pg returns it: Date for timestamptz, work_date already
// formatted to YYYY-MM-DD by the service SQL. The nullable enum columns are NULL.
const pgRow = vi.hoisted(() => ({
  tenant: '11111111-1111-4111-8111-111111111111',
  entry_id: '22222222-2222-4222-8222-222222222222',
  user_id: '33333333-3333-4333-8333-333333333333',
  start_time: new Date('2026-10-12T13:00:00Z'),
  end_time: new Date('2026-10-12T14:00:00Z'),
  notes: null,
  work_item_id: null,
  billable_duration: 0,
  work_item_type: null,
  approval_status: 'DRAFT',
  time_sheet_id: '44444444-4444-4444-8444-444444444444',
  created_at: new Date('2026-10-12T14:01:00Z'),
  updated_at: null,
  service_id: null,
  tax_region: null,
  invoiced: false,
  tax_rate_id: null,
  contract_line_id: null,
  work_date: '2026-10-12',
  work_timezone: 'America/New_York',
  created_by: null,
  updated_by: null,
  contract_line_source: null,
  contract_line_unresolved_reason: null,
  catalog_pricing_acknowledged_at: null,
  catalog_pricing_acknowledged_by: null,
  billing_mode: 'commercial',
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  const query: any = {
    where: () => query,
    select: () => query,
    orderBy: () => Promise.resolve([pgRow]),
  };
  return { ...actual, tenantDb: () => ({ table: () => query }) };
});

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';

const SPEC_DIR = path.resolve(__dirname, '../../../../../sdk/docs/openapi');
const SPECS = ['alga-openapi.ee.json', 'alga-openapi.ce.json'];

async function buildRows() {
  const service = new TimeSheetService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: { raw: (sql: string) => sql }, tenant: pgRow.tenant });
  const rows = await service.getTimeSheetEntries(pgRow.time_sheet_id, { tenant: pgRow.tenant } as any);
  return JSON.parse(JSON.stringify(rows));
}

describe.each(SPECS)('published time sheet schemas validate real rows (%s)', (specFile) => {
  const spec = JSON.parse(fs.readFileSync(path.join(SPEC_DIR, specFile), 'utf-8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ ...spec, $id: 'https://alga.test/spec.json' });
  const compile = (name: string) => ajv.compile({ $ref: `https://alga.test/spec.json#/components/schemas/${name}` });

  it('WorkV1TimeSheetEntriesResponse accepts a row with NULL enum columns', async () => {
    const rows = await buildRows();
    expect(rows[0]).toMatchObject({ contract_line_source: null, contract_line_unresolved_reason: null, work_item_type: null });
    const validate = compile('WorkV1TimeSheetEntriesResponse');
    const ok = validate({ data: rows });
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('WorkV1TimeSheetSearchResponse accepts include_entries rows with NULL enum columns', async () => {
    const rows = await buildRows();
    const sheet = {
      tenant: pgRow.tenant,
      id: pgRow.time_sheet_id,
      user_id: pgRow.user_id,
      period_id: '55555555-5555-4555-8555-555555555555',
      approval_status: 'DRAFT',
      submitted_at: null,
      approved_at: null,
      approved_by: null,
      notes: null,
      user_name: 'Erin Entries',
      time_entries: rows,
    };
    const validate = compile('WorkV1TimeSheetSearchResponse');
    const ok = validate({ data: [sheet] });
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});
