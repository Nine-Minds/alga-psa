import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { buildClientCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
  createTestDbConnection,
  wireLocalTestDbEnv,
} from './_dbTestUtils';

// Real-database regression for the grouped zero-dollar duplicate escape.
// Charge persistence links a recurring service period only when a charge
// references it; Emerald City's September window (a bucket line plus two
// usage lines with no activity) produced ZERO charges, so its three
// recurring_service_periods rows stayed lifecycle_state=generated with no
// invoice_id — invisible to the duplicate detector, and the same window was
// invoiced twice (INV-000066/67). claimRecurringServicePeriodsForSelectionInputs
// is the sweep that must claim every period the selected execution windows
// represent, or abort atomically. This suite exercises it against real pg.

// invoiceService pulls the invoice-number generator and auth helpers for its
// other exports; neither participates in period claiming.
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  generateInvoiceNumber: vi.fn(),
}));
vi.mock('../services/taxService', () => ({
  TaxService: class TaxService {},
}));
vi.mock('../lib/authHelpers', () => ({
  getCurrentUserAsync: vi.fn(),
  hasPermissionAsync: vi.fn(),
  getSessionAsync: vi.fn(),
  getAnalyticsAsync: vi.fn(),
}));

const { claimRecurringServicePeriodsForSelectionInputs } = await import(
  '../services/invoiceService'
);

const TENANT = uuidv4();
const CLIENT_ID = uuidv4();
const INVOICE_ID = uuidv4();
const WINDOW_START = '2026-10-01';
const WINDOW_END = '2026-11-01';
const PERIOD_KEY = 'period:2026-09-01:2026-10-01';

// Mirrors the live repro: one bucket line and two usage lines sharing the
// September arrears window, none of which produce a charge without activity.
const GROUP_LINES = [
  { lineId: uuidv4(), chargeFamily: 'bucket' },
  { lineId: uuidv4(), chargeFamily: 'usage' },
  { lineId: uuidv4(), chargeFamily: 'usage' },
].map((line) => ({
  ...line,
  scheduleKey: `schedule:${TENANT}:client_contract_line:${line.lineId}:client:arrears`,
}));

let db: Knex;

async function insertGroupServicePeriods(): Promise<void> {
  for (const line of GROUP_LINES) {
    await db('recurring_service_periods').insert({
      tenant: TENANT,
      schedule_key: line.scheduleKey,
      period_key: PERIOD_KEY,
      revision: 1,
      obligation_id: line.lineId,
      obligation_type: 'client_contract_line',
      charge_family: line.chargeFamily,
      cadence_owner: 'client',
      due_position: 'arrears',
      lifecycle_state: 'generated',
      service_period_start: '2026-09-01',
      service_period_end: '2026-10-01',
      invoice_window_start: WINDOW_START,
      invoice_window_end: WINDOW_END,
      provenance_kind: 'generated',
      source_rule_version: '1.0.0',
    });
  }
}

function buildSelectorInputs(lines = GROUP_LINES) {
  return lines.map((line) =>
    buildClientCadenceDueSelectionInput({
      clientId: CLIENT_ID,
      scheduleKey: line.scheduleKey,
      periodKey: PERIOD_KEY,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    }),
  );
}

async function claimInTransaction(params: {
  invoiceId: string;
  selectorInputs: ReturnType<typeof buildSelectorInputs>;
}): Promise<void> {
  await db.transaction(async (trx) => {
    await claimRecurringServicePeriodsForSelectionInputs({
      tx: trx,
      tenant: TENANT,
      invoiceId: params.invoiceId,
      selectorInputs: params.selectorInputs,
      linkedAt: new Date().toISOString(),
    });
  });
}

async function fetchGroupRows() {
  return db('recurring_service_periods')
    .where({ tenant: TENANT })
    .orderBy('schedule_key')
    .select('schedule_key', 'lifecycle_state', 'invoice_id', 'invoice_charge_detail_id');
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  await db('tenants').insert({
    tenant: TENANT,
    client_name: 'Grouped Zero Dollar Claim Test',
    email: `zero-dollar-claim-${TENANT.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
});

afterEach(async () => {
  await db('recurring_service_periods').where({ tenant: TENANT }).del();
});

afterAll(async () => {
  await db('recurring_service_periods').where({ tenant: TENANT }).del();
  await db('tenants').where({ tenant: TENANT }).del();
  await db.destroy().catch(() => undefined);
});

describe('claimRecurringServicePeriodsForSelectionInputs (DB-backed)', () => {
  it('claims every grouped zero-dollar period for the invoice', async () => {
    await insertGroupServicePeriods();

    await claimInTransaction({ invoiceId: INVOICE_ID, selectorInputs: buildSelectorInputs() });

    const rows = await fetchGroupRows();
    expect(rows).toHaveLength(GROUP_LINES.length);
    for (const row of rows) {
      expect(row.lifecycle_state).toBe('billed');
      expect(row.invoice_id).toBe(INVOICE_ID);
      // No charge backs these periods; the linkage columns stay honest.
      expect(row.invoice_charge_detail_id).toBeNull();
    }

    // The claim is exactly what arms the production duplicate pre-check
    // (recurring_service_periods with a non-null invoice_id for the same
    // schedule/period/window identity): a repeat generation now finds the
    // prior invoice instead of silently creating a second one.
    const firstLine = GROUP_LINES[0]!;
    const armed = await db('recurring_service_periods')
      .where({
        tenant: TENANT,
        cadence_owner: 'client',
        schedule_key: firstLine.scheduleKey,
        period_key: PERIOD_KEY,
        invoice_window_start: WINDOW_START,
        invoice_window_end: WINDOW_END,
      })
      .whereNotNull('invoice_id')
      .first('invoice_id');
    expect(armed?.invoice_id).toBe(INVOICE_ID);
  });

  it('leaves charge-linked rows of the same invoice untouched', async () => {
    await insertGroupServicePeriods();
    const chargeLinkedLine = GROUP_LINES[0]!;
    const detailId = uuidv4();
    await db('recurring_service_periods')
      .where({ tenant: TENANT, schedule_key: chargeLinkedLine.scheduleKey })
      .update({
        lifecycle_state: 'billed',
        invoice_id: INVOICE_ID,
        invoice_charge_id: uuidv4(),
        invoice_charge_detail_id: detailId,
        invoice_linked_at: new Date().toISOString(),
      });

    await claimInTransaction({ invoiceId: INVOICE_ID, selectorInputs: buildSelectorInputs() });

    const rows = await fetchGroupRows();
    for (const row of rows) {
      expect(row.lifecycle_state).toBe('billed');
      expect(row.invoice_id).toBe(INVOICE_ID);
    }
    const chargeLinkedRow = rows.find(
      (row) => row.schedule_key === chargeLinkedLine.scheduleKey,
    );
    expect(chargeLinkedRow?.invoice_charge_detail_id).toBe(detailId);
  });

  it('aborts atomically when a period is already claimed by another invoice', async () => {
    await insertGroupServicePeriods();
    const otherInvoiceId = uuidv4();
    const contestedLine = GROUP_LINES[2]!;
    await db('recurring_service_periods')
      .where({ tenant: TENANT, schedule_key: contestedLine.scheduleKey })
      .update({
        lifecycle_state: 'billed',
        invoice_id: otherInvoiceId,
        invoice_linked_at: new Date().toISOString(),
      });

    await expect(
      claimInTransaction({ invoiceId: INVOICE_ID, selectorInputs: buildSelectorInputs() }),
    ).rejects.toThrow(/already claimed by invoice/);

    // The transaction rolled back: no partial claims survive, so the failed
    // attempt cannot half-own the window.
    const rows = await fetchGroupRows();
    const unclaimed = rows.filter((row) => row.invoice_id === null);
    expect(unclaimed).toHaveLength(GROUP_LINES.length - 1);
    for (const row of unclaimed) {
      expect(row.lifecycle_state).toBe('generated');
    }
  });

  it('aborts when a selected execution window has no period rows at all', async () => {
    await expect(
      claimInTransaction({ invoiceId: INVOICE_ID, selectorInputs: buildSelectorInputs() }),
    ).rejects.toThrow(/were not materialized/);
  });
});
