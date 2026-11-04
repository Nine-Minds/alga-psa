import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { TestContext } from '../../../../test-utils/testContext';
import {
  createFixedPlanAssignment,
  createTestService,
  setupClientTaxConfiguration,
} from '../../../../test-utils/billingTestHelpers';
import { createTicket } from '../../../../test-utils/billingProfileTestHelpers';
import { reconcileLineAllocations } from '@alga-psa/shared/billingClients/hourBlockService';
import { generateInvoiceForNormalizedSelectionInputs } from '@alga-psa/billing/actions/invoiceGeneration';
import { finalizeInvoiceWithKnex } from '@alga-psa/billing/actions/invoiceModification';
import { materializeContractCadenceServicePeriodsForContract } from '@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization';
import { buildContractCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

// Late time on a cadence Prepaid Block line, through the real engine and real
// invoice generation on a migrated database (alga-2026-0002684).
//
// A $150/h line carries a monthly cadence Prepaid Block (10 h / $1,500) whose
// blocks roll over one period. Approved time dated in November that arrives after
// December's invoice was issued draws from the block valid on the work date
// (November's), bills only the minutes beyond what that block has left as overage
// with the late label, and rides the line's next invoice exactly once.
//
// Opt in with HOUR_BLOCK_DB_TESTS=1 (the workspace DB runner sets it).
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

let authenticatedTenant = '';
let authenticatedUser = '';
vi.mock('@alga-psa/auth', async (importOriginal) => {
  const original = (await importOriginal()) as typeof import('@alga-psa/auth');
  return {
    ...original,
    withAuth:
      (handler: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        handler(
          { user_id: authenticatedUser, user_type: 'internal', tenant: authenticatedTenant },
          { tenant: authenticatedTenant },
          ...args,
        ),
  };
});
vi.mock('@alga-psa/auth/rbac', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('@alga-psa/auth/rbac')),
  hasPermission: vi.fn().mockResolvedValue(true),
}));

const NOV = { start: '2025-11-01', end: '2025-12-01' };
const DEC = { start: '2025-12-01', end: '2026-01-01' };
const JAN = { start: '2026-01-01', end: '2026-02-01' };
const FEB = { start: '2026-02-01', end: '2026-03-01' };

interface World {
  contractId: string;
  hourlyLineId: string;
  hourlyServiceId: string;
  fixedLineId: string;
}

describe.runIf(enabled)('Prepaid Block late time on a cadence line (real engine, migrated DB)', () => {
  const helpers = TestContext.createHelpers();
  let context: TestContext;
  let db: Knex;

  beforeAll(async () => {
    context = await helpers.beforeAll({ runSeeds: true, clientName: 'Late block client', userType: 'internal' });
  }, 180_000);

  beforeEach(async () => {
    context = await helpers.beforeEach();
    db = context.db;
    authenticatedTenant = context.tenantId;
    authenticatedUser = context.userId;
  }, 60_000);

  afterAll(async () => {
    await helpers.afterAll();
  }, 60_000);

  async function seedWorld(rolloverPeriods: number): Promise<World> {
    const taxRateId = await setupClientTaxConfiguration(context);
    const price = async (name: string, method: 'fixed' | 'hourly', rate: number) => {
      const serviceId = await createTestService(context, {
        service_name: name,
        billing_method: method,
        default_rate: rate,
        unit_of_measure: 'each',
        tax_rate_id: taxRateId,
      });
      await db('service_prices')
        .insert({ tenant: context.tenantId, service_id: serviceId, currency_code: 'USD', rate, effective_date: '1970-01-01' })
        .onConflict(['tenant', 'service_id', 'currency_code', 'effective_date'])
        .merge({ rate });
      return serviceId;
    };
    const fixedService = await price('Late block managed support', 'fixed', 150_000);
    const hourlyService = await price('Late block engineering', 'hourly', 15_000);
    const contractId = uuidv4();
    const common = {
      contractId,
      clientContractId: uuidv4(),
      clientId: context.clientId,
      startDate: '2025-11-01',
      endDate: null,
      billingFrequency: 'monthly' as const,
      cadenceOwner: 'contract' as const,
      enableProration: false,
    };
    const fixed = await createFixedPlanAssignment(context, fixedService, {
      ...common, billingTiming: 'advance' as const, planName: 'Late block fixed', baseRateCents: 150_000,
    });
    const hourly = await createFixedPlanAssignment(context, hourlyService, {
      ...common, billingTiming: 'arrears' as const, planName: 'Late block prepaid block', baseRateCents: 15_000,
    });
    // Convert the Fixed configuration into an Hourly one (the block rides an Hourly line).
    const config = await db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, contract_line_id: hourly.contractLineId, service_id: hourlyService, configuration_type: 'Fixed' })
      .first('config_id');
    await db('contract_line_service_fixed_config').where({ tenant: context.tenantId, config_id: config.config_id }).delete();
    await db('contract_line_service_configuration')
      .where({ tenant: context.tenantId, config_id: config.config_id })
      .update({ configuration_type: 'Hourly' });
    await db('contract_lines').where({ tenant: context.tenantId, contract_line_id: hourly.contractLineId }).update({ contract_line_type: 'Hourly' });
    await db('contract_line_service_hourly_configs').insert({
      tenant: context.tenantId, config_id: config.config_id, hourly_rate: 15_000, minimum_billable_time: 1, round_up_to_nearest: 1,
    });
    await db('contract_line_service_hourly_config').insert({
      tenant: context.tenantId, config_id: config.config_id, minimum_billable_time: 1, round_up_to_nearest: 1,
      enable_overtime: false, enable_after_hours_rate: false,
    });
    await db('contract_line_prepaid_blocks').insert({
      tenant: context.tenantId, contract_line_id: hourly.contractLineId, block_minutes: 600, block_price: 150_000,
      expiry_months: null, trigger_on_exhaustion: false, trigger_on_expiry: false, replenishment_tier: 'draft',
      sold_as_service_id: hourlyService, issue_mode: 'cadence', rollover_periods: rolloverPeriods,
    });
    await db.transaction((trx) =>
      materializeContractCadenceServicePeriodsForContract(trx, {
        tenant: context.tenantId, contractId, sourceRunPrefix: 'late-block-db',
      }),
    );
    return { contractId, hourlyLineId: hourly.contractLineId, hourlyServiceId: hourlyService, fixedLineId: fixed.contractLineId };
  }

  /** Approved, billable time on the block line, drawn against the line's live blocks like the save hook does. */
  async function logApprovedHours(world: World, date: string, minutes: number): Promise<string> {
    const ticketId = await createTicket(
      { db, tenantId: context.tenantId },
      { clientId: context.clientId, title: 'Late block work', ticketNumber: `LB-${uuidv4().slice(0, 8)}` },
    );
    const entryId = uuidv4();
    const start = new Date(`${date}T08:00:00Z`);
    await db('time_entries').insert({
      tenant: context.tenantId, entry_id: entryId, contract_line_id: world.hourlyLineId,
      work_item_id: ticketId, work_item_type: 'ticket', user_id: context.userId, service_id: world.hourlyServiceId,
      work_date: date, start_time: start.toISOString(),
      end_time: new Date(start.getTime() + minutes * 60_000).toISOString(),
      billable_duration: minutes, invoiced: false, approval_status: 'APPROVED', work_timezone: 'UTC',
    });
    await db.transaction((trx) => reconcileLineAllocations(trx, context.tenantId, world.hourlyLineId));
    return entryId;
  }

  /** Generates the window's real invoice (optionally issuing it) and returns what was written. */
  async function invoiceWindow(world: World, window: { start: string; end: string }, options: { finalize?: boolean } = {}) {
    const invoice: any = await generateInvoiceForNormalizedSelectionInputs({
      user: { user_id: context.userId, user_type: 'internal', tenant: context.tenantId } as never,
      tenant: context.tenantId,
      knex: db,
      normalizedSelectorInputs: [
        world.fixedLineId, world.hourlyLineId,
      ].map((contractLineId) =>
        buildContractCadenceDueSelectionInput({
          clientId: context.clientId,
          contractId: world.contractId,
          contractLineId,
          windowStart: `${window.start}T00:00:00Z`,
          windowEnd: `${window.end}T00:00:00Z`,
        }),
      ),
    });
    const invoiceId: string | null = invoice?.invoice_id ?? null;
    const rows = invoiceId
      ? await db('invoice_charges').where({ tenant: context.tenantId, invoice_id: invoiceId }).orderBy('item_id')
      : [];
    if (options.finalize && invoiceId) {
      await finalizeInvoiceWithKnex(invoiceId, db, context.tenantId, context.userId);
    }
    return { invoiceId, rows };
  }

  const text = (row: any) => String(row.description ?? '');
  const isOverage = (row: any) => text(row).includes('(over prepaid block)');
  const blockRemaining = async (world: World) =>
    (await db('hour_blocks').where({ tenant: context.tenantId, contract_line_id: world.hourlyLineId }).orderBy('valid_from'))
      .map((row) => Number(row.remaining_minutes));

  it('bills late time beyond the earlier block as overage with the late label, once, and never draws the current block', async () => {
    const world = await seedWorld(1);
    await invoiceWindow(world, NOV, { finalize: true });
    await invoiceWindow(world, DEC, { finalize: true });
    // 14 h dated 10 Nov, approved after December's invoice was issued.
    const entryId = await logApprovedHours(world, '2025-11-10', 840);

    const jan = await invoiceWindow(world, JAN, { finalize: true });
    // 10 h from November's block (a $0 draw line) and 4 h overage at $150/h = $600.
    const overage = jan.rows.filter(isOverage);
    expect(overage).toHaveLength(1);
    expect(Number(overage[0].quantity)).toBe(4);
    expect(Number(overage[0].net_amount)).toBe(60_000);
    expect(text(overage[0])).toContain('late time, service period 2025-11-01');
    const draw = jan.rows.filter((row) => text(row).startsWith('Prepaid hour block'));
    expect(draw).toHaveLength(1);
    expect(Number(draw[0].quantity)).toBe(10);
    expect(Number(draw[0].net_amount)).toBe(0);
    expect(text(draw[0])).toContain('10.0 hrs consumed, 0.0 hrs remaining');
    // The month's block fee and fixed fee are unchanged by the late time: $1,500 each.
    expect(jan.rows.filter((row) => Number(row.net_amount) === 150_000)).toHaveLength(2);
    // The December block was not touched; November's is spent.
    expect((await blockRemaining(world)).slice(0, 2)).toEqual([0, 600]);
    expect((await db('time_entries').where({ tenant: context.tenantId, entry_id: entryId }).first()).invoiced).toBe(true);

    // Exactly once: February carries neither the overage nor a draw for this entry.
    const feb = await invoiceWindow(world, FEB);
    expect(feb.rows.filter(isOverage)).toEqual([]);
    expect(feb.rows.filter((row) => text(row).includes('late time'))).toEqual([]);
  }, 300_000);

  it('bills late time fully covered by the earlier block at $0 on the next invoice, once', async () => {
    const world = await seedWorld(1);
    await invoiceWindow(world, NOV, { finalize: true });
    await invoiceWindow(world, DEC, { finalize: true });
    const entryId = await logApprovedHours(world, '2025-11-10', 480);

    const jan = await invoiceWindow(world, JAN, { finalize: true });
    expect(jan.rows.filter(isOverage)).toEqual([]);
    expect((await blockRemaining(world)).slice(0, 2)).toEqual([120, 600]);
    expect((await db('time_entries').where({ tenant: context.tenantId, entry_id: entryId }).first()).invoiced).toBe(true);
    const feb = await invoiceWindow(world, FEB);
    expect(feb.rows.filter((row) => text(row).includes('late time'))).toEqual([]);
  }, 300_000);

  it.each([
    { minutes: 480, covered: 8, overage: 0, remaining: 120 },
    { minutes: 840, covered: 10, overage: 4, remaining: 0 },
  ])('draws $covered hours from the expired historical block and bills $overage overage once', async ({ minutes, covered, overage, remaining }) => {
    const world = await seedWorld(0);
    await invoiceWindow(world, NOV, { finalize: true });
    await invoiceWindow(world, DEC, { finalize: true });
    const blocks = await db('hour_blocks')
      .where({ tenant: context.tenantId, contract_line_id: world.hourlyLineId })
      .orderBy('valid_from').select('block_id', 'status');
    await db('hour_blocks').where({ tenant: context.tenantId, block_id: blocks[0].block_id }).update({ status: 'expired' });
    const entryId = await logApprovedHours(world, '2025-11-10', minutes);

    const jan = await invoiceWindow(world, JAN, { finalize: true });
    const draws = jan.rows.filter((row) => text(row).startsWith('Prepaid hour block'));
    expect(draws).toHaveLength(1);
    expect(Number(draws[0].quantity)).toBe(covered);
    const charges = jan.rows.filter(isOverage);
    expect(charges).toHaveLength(overage ? 1 : 0);
    if (overage) {
      expect(Number(charges[0].quantity)).toBe(overage);
      expect(Number(charges[0].net_amount)).toBe(overage * 15_000);
      expect(text(charges[0])).toContain('late time, service period 2025-11-01');
    }
    const priorBlocks = await db('hour_blocks').where({ tenant: context.tenantId })
      .whereIn('block_id', blocks.map((block: any) => block.block_id)).orderBy('valid_from');
    expect(priorBlocks.map((block: any) => [block.status, Number(block.remaining_minutes)])).toEqual([['expired', remaining], ['active', 600]]);
    expect((await db('time_entries').where({ tenant: context.tenantId, entry_id: entryId }).first()).invoiced).toBe(true);
    const feb = await invoiceWindow(world, FEB);
    expect(feb.rows.filter(isOverage)).toEqual([]);
    expect(feb.rows.filter((row) => text(row).startsWith('Prepaid hour block'))).toEqual([]);
  }, 300_000);
});
