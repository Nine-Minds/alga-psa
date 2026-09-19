import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../../test-utils/dbConfig';
import { createClient } from '../../../../../test-utils/testDataFactory';
import { runContractCadenceReplenishmentForTenant } from '@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization';

/**
 * Genuine concurrency for the contract-cadence sweep. The sibling TestContext
 * suite binds all fixtures to one uncommitted transaction that a second
 * connection could never see. Here the fixture is committed on a plain pool and
 * each replenishment owns a real transaction on its own pooled connection, so
 * the per-tenant `pg_advisory_xact_lock` is what serializes them exactly as it
 * does across production application pods.
 */

const dateOnly = (value: unknown) => new Date(value as string | Date).toISOString().slice(0, 10);

let db: Knex;
let tenantId: string;

describe('Contract-cadence replenishment under concurrent execution', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    const tenantRow = await db('tenants').first();
    if (!tenantRow?.tenant) {
      throw new Error('Seeded test database has no tenant');
    }
    tenantId = tenantRow.tenant as string;
  }, 240000);

  afterAll(async () => {
    await db?.destroy();
  }, 30000);

  async function seedConcurrentFixture(): Promise<{ obligationId: string; clientId: string }> {
    const clientId = await createClient(db, tenantId, `Concurrent Contract Client ${uuidv4().slice(0, 8)}`);
    const contractId = uuidv4();
    const assignmentId = uuidv4();
    const obligationId = uuidv4();
    const now = new Date().toISOString();

    await db('contracts').insert({
      contract_id: contractId,
      tenant: tenantId,
      contract_name: 'Concurrent Contract',
      contract_description: 'concurrency fixture',
      billing_frequency: 'monthly',
      is_active: true,
      status: 'Active',
      is_template: false,
      currency_code: 'USD',
      created_at: now,
      updated_at: now,
    });
    await db('client_contracts').insert({
      client_contract_id: assignmentId,
      tenant: tenantId,
      client_id: clientId,
      contract_id: contractId,
      start_date: '2026-02-08',
      end_date: null,
      is_active: true,
      status: 'pending',
      po_required: false,
      po_number: null,
      po_amount: null,
      template_contract_id: null,
      created_at: now,
      updated_at: now,
    });
    await db('contract_lines').insert({
      contract_line_id: obligationId,
      tenant: tenantId,
      contract_id: contractId,
      contract_line_name: 'Concurrent Contract Line',
      billing_frequency: 'monthly',
      billing_timing: 'arrears',
      is_custom: false,
      contract_line_type: 'Fixed',
      cadence_owner: 'contract',
      is_active: true,
      custom_rate: 1262860,
      created_at: now,
      updated_at: now,
    });

    // Six initial periods: first locked, the rest billed through Aug 8.
    const scheduleKey = `schedule:${tenantId}:contract_line:${obligationId}:contract:arrears`;
    const rows: Array<Record<string, unknown>> = [];
    const periods: Array<[string, string, string, string]> = [
      ['2026-02-08', '2026-03-08', '2026-03-08', '2026-04-08'],
      ['2026-03-08', '2026-04-08', '2026-04-08', '2026-05-08'],
      ['2026-04-08', '2026-05-08', '2026-05-08', '2026-06-08'],
      ['2026-05-08', '2026-06-08', '2026-06-08', '2026-07-08'],
      ['2026-06-08', '2026-07-08', '2026-07-08', '2026-08-08'],
      ['2026-07-08', '2026-08-08', '2026-08-08', '2026-09-08'],
    ];
    for (let index = 0; index < periods.length; index += 1) {
      const [serviceStart, serviceEnd, invoiceStart, invoiceEnd] = periods[index];
      const billed = index > 0;
      rows.push({
        record_id: uuidv4(),
        tenant: tenantId,
        schedule_key: scheduleKey,
        period_key: `period:${serviceStart}:${serviceEnd}`,
        revision: 1,
        obligation_id: obligationId,
        obligation_type: 'contract_line',
        charge_family: 'fixed',
        cadence_owner: 'contract',
        due_position: 'arrears',
        lifecycle_state: billed ? 'billed' : 'locked',
        service_period_start: serviceStart,
        service_period_end: serviceEnd,
        invoice_window_start: invoiceStart,
        invoice_window_end: invoiceEnd,
        activity_window_start: null,
        activity_window_end: null,
        timing_metadata: null,
        provenance_kind: 'generated',
        source_rule_version: 'contract_cadence|billing_cycle:monthly|anchor:2026-02-08|due:arrears',
        reason_code: 'initial_materialization',
        source_run_key: 'concurrent-fixture',
        supersedes_record_id: null,
        invoice_id: billed ? uuidv4() : null,
        invoice_charge_id: billed ? uuidv4() : null,
        invoice_charge_detail_id: billed ? uuidv4() : null,
        invoice_linked_at: billed ? now : null,
        created_at: now,
        updated_at: now,
      });
    }
    await db('recurring_service_periods').insert(rows);

    return { obligationId, clientId };
  }

  it('two overlapping runs serialize on the tenant lock and never duplicate a period', async () => {
    const { obligationId, clientId } = await seedConcurrentFixture();

    const [first, second] = await Promise.all([
      runContractCadenceReplenishmentForTenant(db, {
        tenant: tenantId,
        sourceRunPrefix: 'concurrent-nightly',
        asOf: '2026-09-15T00:00:00Z',
      }),
      runContractCadenceReplenishmentForTenant(db, {
        tenant: tenantId,
        sourceRunPrefix: 'concurrent-nightly',
        asOf: '2026-09-15T00:00:00Z',
      }),
    ]);

    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);

    const rows = await db('recurring_service_periods')
      .where({ tenant: tenantId, obligation_id: obligationId })
      .orderBy('service_period_start', 'asc');
    const active = rows.filter((row) => row.lifecycle_state !== 'superseded');

    // The recovered period exists exactly once...
    const recovered = active.filter(
      (row) => dateOnly(row.service_period_start) === '2026-08-08'
        && dateOnly(row.service_period_end) === '2026-09-08',
    );
    expect(recovered).toHaveLength(1);
    expect(dateOnly(recovered[0].invoice_window_start)).toBe('2026-09-08');
    expect(dateOnly(recovered[0].invoice_window_end)).toBe('2026-10-08');

    // ...and no (schedule_key, period_key, revision) slot was written twice.
    const activeKeys = active.map((row) => `${row.schedule_key}:${row.period_key}:${row.revision}`);
    expect(new Set(activeKeys).size).toBe(activeKeys.length);

    // Only one of the two serialized runs did the work.
    const generated = first.periodsGenerated + second.periodsGenerated;
    const superseded = first.periodsSuperseded + second.periodsSuperseded;
    expect(generated).toBeGreaterThanOrEqual(1);
    expect(superseded).toBe(0);

    const invoice = await db('invoices').where({ tenant: tenantId, client_id: clientId }).first();
    expect(invoice).toBeUndefined();
  }, 60000);
  it('does not supersede a period invoiced after the sweep read its ledger', async () => {
    const { obligationId } = await seedConcurrentFixture();
    const template = await db('recurring_service_periods')
      .where({ tenant: tenantId, obligation_id: obligationId }).first();
    const recordId = uuidv4();
    await db('recurring_service_periods').insert({
      ...template,
      record_id: recordId,
      period_key: 'period:2026-08-08:2026-09-08',
      lifecycle_state: 'generated',
      service_period_start: '2026-08-08', service_period_end: '2026-09-08',
      // Wrong arrears window requires a replacement, provoking a guarded update.
      invoice_window_start: '2026-08-08', invoice_window_end: '2026-09-08',
      invoice_id: null, invoice_charge_id: null, invoice_charge_detail_id: null,
      invoice_linked_at: null,
    });

    const billingTrx = await db.transaction();
    await billingTrx('recurring_service_periods')
      .where({ tenant: tenantId, record_id: recordId })
      .update({
        lifecycle_state: 'billed',
        invoice_id: uuidv4(), invoice_charge_id: uuidv4(), invoice_charge_detail_id: uuidv4(),
        invoice_linked_at: new Date().toISOString(),
      });
    const billedRow = await billingTrx('recurring_service_periods')
      .where({ tenant: tenantId, record_id: recordId }).first();

    // The uncommitted invoice holds a row lock. The sweep sees the previous
    // generated state, then waits on that lock when trying to supersede it.
    let onQuery: (query: { sql: string; bindings?: unknown[] }) => void;
    let timer: ReturnType<typeof setTimeout>;
    const attemptedWrite = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Sweep did not attempt its stale ledger update')), 10000);
      onQuery = (query) => {
        if (query.sql.startsWith('update "recurring_service_periods"') && query.bindings?.includes(recordId)) {
          resolve();
        }
      };
      db.on('query', onQuery);
    });
    const params = { tenant: tenantId, sourceRunPrefix: 'invoice-race', asOf: '2026-09-15T00:00:00Z' };
    const pendingSweep = runContractCadenceReplenishmentForTenant(db, params);
    try {
      await attemptedWrite;
      await billingTrx.commit();
      const summary = await pendingSweep;
      expect(summary.failures).toEqual(expect.arrayContaining([
        expect.objectContaining({ contractLineId: obligationId, error: expect.stringContaining('changed during replenishment') }),
      ]));
      expect(await db('recurring_service_periods').where({ tenant: tenantId, record_id: recordId }).first()).toEqual(billedRow);
      const retry = await runContractCadenceReplenishmentForTenant(db, params);
      expect(retry.failures).toEqual([]);
      expect(await db('recurring_service_periods').where({ tenant: tenantId, record_id: recordId }).first()).toEqual(billedRow);
    } finally {
      clearTimeout(timer!);
      db.removeListener('query', onQuery!);
      if (!billingTrx.isCompleted()) await billingTrx.rollback();
      await pendingSweep;
    }
  }, 60000);

});
