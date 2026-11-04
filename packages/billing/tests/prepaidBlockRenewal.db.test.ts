import { afterEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';
import {
  isRenewalContract,
  syncPrepaidBlockIssuancesForContract,
  syncPrepaidBlockIssuancesForContractLine,
} from '../src/services/prepaidBlockIssuanceSync';
import {
  reownBlocksForRenewalActivation,
  scheduleRenewalIssuancesForRolledCycle,
} from '../src/services/prepaidBlockRenewalService';
import {
  EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON,
  releaseAndVoidLinkedBlock,
  scheduleExpiryIssuanceForActivatedBlock,
} from '../src/services/prepaidBlockLifecycleService';
import { fetchPrepaidBlockIssuanceDueWorkRows } from '../src/lib/prepaidBlockDueWork';

// Guarded DB tests for the Prepaid Block renewal behaviour (alga-2026-0002695, captain decision 1):
// renewal-cycle issuance, due-work listing, renewal draft activation (block re-ownership), the
// renewal-contract start block, and the expiry-issuance guard past contract end. Run with
// HOUR_BLOCK_DB_TESTS=1 (see prepaidBlockInvoicing.db.test.ts for the env vars).
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

let db: Knex;
let tenant: string;
let userId: string;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: userId, user_type: 'internal' }, { tenant }, ...args),
  getSession: vi.fn(async () => ({ user: { id: userId } })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: db, tenant })) };
});

interface World {
  clientId: string;
  ticketId: string;
  serviceId: string;
  otherServiceId: string;
  /** Source (expiring) term. */
  contractId: string;
  lineId: string;
  clientContractId: string;
  /** Renewal contract: linked from the source assignment through created_draft_contract_id. */
  renewalContractId: string;
  renewalLineId: string;
  renewalClientContractId: string;
}

async function setup(opts: {
  triggerOnRenewal?: boolean;
  renewalTriggerOnRenewal?: boolean;
  renewalTriggerOnExpiry?: boolean;
  renewalLineServices?: 'same' | 'other';
  endDate?: string | null;
} = {}): Promise<World> {
  db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
  tenant = uuidv4();
  userId = uuidv4();
  const clientId = uuidv4();
  const typeId = uuidv4();
  const serviceId = uuidv4();
  const otherServiceId = uuidv4();
  const ticketId = uuidv4();
  const contractId = uuidv4();
  const lineId = uuidv4();
  const clientContractId = uuidv4();
  const renewalContractId = uuidv4();
  const renewalLineId = uuidv4();
  const renewalClientContractId = uuidv4();
  const profileId = uuidv4();

  await db('tenants').insert({ tenant, client_name: 'PBR Tenant', email: 'pbr@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBR Client' });
  await db('service_types').insert({ id: typeId, tenant, name: 'PBR Type', is_active: true, order_number: 1 });
  for (const [id, name] of [[serviceId, 'Remote Support'], [otherServiceId, 'Onsite Support']] as const) {
    await db('service_catalog').insert({
      service_id: id, tenant, service_name: name, custom_service_type_id: typeId,
      billing_method: 'hourly', default_rate: 11000, unit_of_measure: 'hour',
      category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
  }
  await db('users').insert({
    user_id: userId, tenant, username: `pbr_${userId.slice(0, 8)}`, hashed_password: 'x',
    email: `pbr_${userId.slice(0, 8)}@test.local`, user_type: 'internal', first_name: 'P', last_name: 'R',
  });
  await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'PBR', ticket_number: `PBR-${ticketId.slice(0, 8)}` });
  await db('client_billing_profiles').insert({ tenant, billing_profile_id: profileId, client_id: clientId, name: 'PBR Profile', is_default: true });
  await db('client_billing_cycles').insert({
    tenant, billing_profile_id: profileId, billing_cycle_id: uuidv4(), client_id: clientId, billing_cycle: 'monthly',
    period_start_date: '2026-12-01', period_end_date: '2027-01-01', effective_date: '2026-12-01',
  });

  // Source contract A (expiring term, or evergreen when endDate is null).
  const endDate = opts.endDate === undefined ? '2026-12-31' : opts.endDate;
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Term A', currency_code: 'EUR', status: 'active', created_at: '2025-12-01T00:00:00Z' });
  {
    // created_draft_contract_id has an FK to contracts: create renewal contract B first, then link.
    await db('contracts').insert({ tenant, contract_id: renewalContractId, contract_name: 'Term B', currency_code: 'EUR', status: 'active', created_at: '2025-12-01T00:00:00Z', renewal_of_contract_id: contractId });
    await db('client_contracts').insert({
      tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
      start_date: '2026-01-01', end_date: endDate, is_active: true, status: 'renewing', created_draft_contract_id: renewalContractId,
    });
    await db('client_contracts').insert({
      tenant, client_contract_id: renewalClientContractId, client_id: clientId, contract_id: renewalContractId,
      start_date: '2027-01-01', is_active: true,
    });
    await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'Block A', contract_line_type: 'Hourly', created_at: '2025-12-01T00:00:00Z' });
    await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
    await db('contract_line_prepaid_blocks').insert({
      tenant, contract_line_id: lineId, block_minutes: 600, block_price: 100000, expiry_months: 12,
      trigger_on_expiry: true, trigger_on_renewal: opts.triggerOnRenewal ?? true, sold_as_service_id: serviceId,
    });
    await db('contract_lines').insert({ tenant, contract_line_id: renewalLineId, contract_id: renewalContractId, contract_line_name: 'Block B', contract_line_type: 'Hourly', created_at: '2025-12-01T00:00:00Z' });
    await db('contract_line_services').insert({
      tenant, contract_line_id: renewalLineId, service_id: opts.renewalLineServices === 'other' ? otherServiceId : serviceId,
    });
    await db('contract_line_prepaid_blocks').insert({
      tenant, contract_line_id: renewalLineId, block_minutes: 600, block_price: 100000, expiry_months: 12,
      trigger_on_expiry: opts.renewalTriggerOnExpiry ?? false, trigger_on_renewal: opts.renewalTriggerOnRenewal ?? true,
      sold_as_service_id: serviceId,
    });
    return {
      clientId, ticketId, serviceId, otherServiceId, contractId, lineId, clientContractId,
      renewalContractId, renewalLineId, renewalClientContractId,
    };
  }
}

afterEach(async () => {
  if (!db) return;
  for (const table of [
    'hour_block_time_allocations', 'hour_block_audit', 'hour_block_service_scopes', 'hour_blocks',
    'contract_line_block_issuances', 'time_entries', 'tickets', 'contract_line_prepaid_blocks', 'contract_line_services',
    'client_billing_cycles', 'client_billing_profiles', 'contract_lines',
  ]) {
    await db(table).where({ tenant }).delete();
  }
  await db('client_contracts').where({ tenant }).update({ created_draft_contract_id: null });
  for (const table of ['client_contracts', 'contracts', 'service_catalog', 'service_types', 'users', 'clients', 'tenants']) {
    await db(table).where({ tenant }).delete();
  }
  await db.destroy();
});

const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const issuancesOf = (lineId: string) => db('contract_line_block_issuances').where({ tenant, contract_line_id: lineId }).orderBy('created_at');

async function insertBlock(w: World, lineId: string, clientContractId: string, opts: {
  remaining: number; expiration: string | null; status?: string; total?: number;
}) {
  const blockId = uuidv4();
  await db('hour_blocks').insert({
    block_id: blockId, tenant, client_id: w.clientId, service_id: w.serviceId,
    total_minutes: opts.total ?? 600, remaining_minutes: opts.remaining, hourly_rate: 10000, purchase_amount: 100000,
    currency_code: 'EUR', status: opts.status ?? 'active', purchased_at: '2026-06-01T00:00:00Z', source_type: 'contract',
    expiration_date: opts.expiration, contract_line_id: lineId, client_contract_id: clientContractId, service_period_record_id: uuidv4(),
  });
  return blockId;
}

const rollover = (w: World, newCycleStart = '2027-01-01', endDate: unknown = null) => db.transaction((trx) =>
  scheduleRenewalIssuancesForRolledCycle(trx, tenant, {
    clientContractId: w.clientContractId, clientId: w.clientId, contractId: w.contractId, endDate, newCycleStart,
  }));

describe.runIf(enabled)('Prepaid Block renewal cycle rollover', () => {
  it('inserts exactly one renewal issuance due on the new cycle start, idempotently, leaving blocks untouched', async () => {
    const w = await setup({ endDate: null });
    const blockId = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 90, expiration: '2027-06-30' });

    expect(await rollover(w)).toEqual([expect.objectContaining({ contractLineId: w.lineId, action: 'scheduled', dueDate: '2027-01-01' })]);
    expect(await rollover(w)).toEqual([{ contractLineId: w.lineId, action: 'already_issued' }]);

    const rows = await issuancesOf(w.lineId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger_kind: 'renewal', status: 'scheduled', client_contract_id: w.clientContractId, client_id: w.clientId });
    expect(dateOnly(rows[0].due_date)).toBe('2027-01-01');

    const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
    expect(dateOnly(block.expiration_date)).toBe('2027-06-30');
    expect(block.remaining_minutes).toBe(90);
    expect(block.status).toBe('active');
  });

  it('stays idempotent after the renewal issuance was invoiced (no second block for the same cycle)', async () => {
    const w = await setup({ endDate: null });
    await rollover(w);
    await db('contract_line_block_issuances').where({ tenant, contract_line_id: w.lineId }).update({ status: 'invoiced' });
    expect(await rollover(w)).toEqual([{ contractLineId: w.lineId, action: 'already_issued' }]);
    expect(await issuancesOf(w.lineId)).toHaveLength(1);
  });

  it('does nothing when trigger_on_renewal is off', async () => {
    const w = await setup({ endDate: null, triggerOnRenewal: false });
    expect(await rollover(w)).toEqual([]);
    expect(await issuancesOf(w.lineId)).toHaveLength(0);
  });

  it('does nothing, without throwing, when an issuance is already open', async () => {
    const w = await setup({ endDate: null });
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: uuidv4(), contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'exhaustion', due_date: '2026-12-15', status: 'scheduled',
    });
    const outcomes = await rollover(w);
    expect(outcomes).toEqual([expect.objectContaining({ contractLineId: w.lineId, action: 'skipped_open_issuance', openKind: 'exhaustion' })]);
    const rows = await issuancesOf(w.lineId);
    expect(rows).toHaveLength(1);
    expect(rows[0].trigger_kind).toBe('exhaustion');
  });

  it('only continues past the new cycle start: a term ending on or before it issues nothing; one ending after it does', async () => {
    const w = await setup({ endDate: '2027-01-01' });
    expect(await rollover(w, '2027-01-01', '2027-01-01')).toEqual([]);
    expect(await issuancesOf(w.lineId)).toHaveLength(0);
    expect(await rollover(w, '2027-01-01', '2027-06-30')).toHaveLength(1);
    expect(await issuancesOf(w.lineId)).toHaveLength(1);
  });
});

describe.runIf(enabled)('Prepaid Block renewal supersedes the expiry issuance', () => {
  it('rollover: an active block with a scheduled expiry issuance still gets the renewal issuance; the expiry one is superseded', async () => {
    const w = await setup({ endDate: null });
    const blockId = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 90, expiration: '2027-06-30' });
    const expiryId = uuidv4();
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: expiryId, contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'expiry', due_date: '2027-06-30', status: 'scheduled', source_block_id: blockId,
    });
    expect(await rollover(w)).toEqual([expect.objectContaining({ action: 'scheduled', dueDate: '2027-01-01' })]);
    expect(await db('contract_line_block_issuances').where({ tenant, issuance_id: expiryId }).first())
      .toMatchObject({ status: 'superseded', cancel_reason: EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON });
    const renewal = (await issuancesOf(w.lineId)).find((r) => r.trigger_kind === 'renewal')!;
    expect(renewal).toMatchObject({ status: 'scheduled', source_block_id: blockId });
    // Idempotent, and the block itself is untouched.
    expect(await rollover(w)).toEqual([{ contractLineId: w.lineId, action: 'already_issued' }]);
    expect(await db('hour_blocks').where({ tenant, block_id: blockId }).first()).toMatchObject({ remaining_minutes: 90, status: 'active' });
  });

  it('voiding the renewal block restores the superseded expiry issuance', async () => {
    const w = await setup({ endDate: null });
    const blockId = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 90, expiration: '2027-06-30' });
    const expiryId = uuidv4();
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: expiryId, contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'expiry', due_date: '2027-06-30', status: 'scheduled', source_block_id: blockId,
    });
    await rollover(w);
    const renewal = (await issuancesOf(w.lineId)).find((r) => r.trigger_kind === 'renewal')!;
    // The renewal block was invoiced as a pending draft block.
    const renewalBlockId = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 600, expiration: null, status: 'pending' });
    await db('contract_line_block_issuances').where({ tenant, issuance_id: renewal.issuance_id })
      .update({ status: 'invoiced', block_id: renewalBlockId });

    await db.transaction((trx) => releaseAndVoidLinkedBlock(trx, tenant, {
      blockId: renewalBlockId, status: 'pending', contractLineId: w.lineId, issuanceId: renewal.issuance_id,
      invoiceId: uuidv4(), userId, now: new Date().toISOString(), reason: 'draft deleted',
    }));
    expect((await db('contract_line_block_issuances').where({ tenant, issuance_id: expiryId }).first()))
      .toMatchObject({ status: 'scheduled', cancel_reason: null });
    expect((await db('contract_line_block_issuances').where({ tenant, issuance_id: renewal.issuance_id }).first()).status).toBe('cancelled');
    expect((await issuancesOf(w.lineId)).filter((r) => r.status === 'scheduled')).toHaveLength(1);
  });

  it('rollover still skips and reports an open exhaustion issuance, a pending block, and a line started after the cycle', async () => {
    const w = await setup({ endDate: null });
    await insertBlock(w, w.lineId, w.clientContractId, { remaining: 600, expiration: null, status: 'pending' });
    expect(await rollover(w)).toEqual([{ contractLineId: w.lineId, action: 'skipped_pending_block' }]);
    await db('hour_blocks').where({ tenant, contract_line_id: w.lineId }).update({ status: 'active' });

    // Config created on the cycle start: never owed that renewal.
    await db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: w.lineId }).update({ created_at: '2027-01-01T08:00:00Z' });
    expect(await rollover(w)).toEqual([{ contractLineId: w.lineId, action: 'skipped_line_started_after_cycle' }]);
    expect(await issuancesOf(w.lineId)).toHaveLength(0);
  });

  it('renewal contract that inherited blocks and an expiry issuance: sync schedules one renewal, superseding the expiry', async () => {
    const w = await setup({ renewalTriggerOnRenewal: true, renewalTriggerOnExpiry: true });
    const live = await insertBlock(w, w.renewalLineId, w.renewalClientContractId, { remaining: 120, expiration: '2027-06-30' });
    const expiryId = uuidv4();
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: expiryId, contract_line_id: w.renewalLineId, client_contract_id: w.renewalClientContractId,
      client_id: w.clientId, trigger_kind: 'expiry', due_date: '2027-06-30', status: 'scheduled', source_block_id: live,
    });
    expect(await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId)))
      .toMatchObject({ action: 'scheduled', dueDate: '2027-01-01' });
    expect(await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId))).toEqual({ action: 'none' });
    const rows = await issuancesOf(w.renewalLineId);
    expect(rows.filter((r) => r.trigger_kind === 'renewal')).toHaveLength(1);
    expect(rows.find((r) => r.issuance_id === expiryId)).toMatchObject({ status: 'superseded', cancel_reason: EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON });
    expect(rows.some((r) => r.trigger_kind === 'contract_start')).toBe(false);
  });

  it('renewal contract that inherited blocks with trigger_on_renewal off issues nothing and lets the blocks run', async () => {
    const w = await setup({ renewalTriggerOnRenewal: false });
    await insertBlock(w, w.renewalLineId, w.renewalClientContractId, { remaining: 120, expiration: '2027-06-30' });
    expect(await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId))).toEqual({ action: 'none' });
    expect(await issuancesOf(w.renewalLineId)).toHaveLength(0);
  });
});

describe.runIf(enabled)('Prepaid Block renewal issuance in due work', () => {
  it('lists the scheduled renewal issuance on its due date with the block price as a PrepaidBlock row', async () => {
    const w = await setup({ endDate: null });
    await rollover(w, '2027-01-01');
    const before = await fetchPrepaidBlockIssuanceDueWorkRows(db, { tenant, asOf: '2026-12-20', options: { dateRange: { to: '2026-12-20' } } });
    expect(before).toHaveLength(0);

    const rows = await fetchPrepaidBlockIssuanceDueWorkRows(db, { tenant, asOf: '2027-01-01', options: { dateRange: { to: '2027-01-01' } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chargeType: 'PrepaidBlock', amountCents: 100000, blockTriggerKind: 'renewal', clientId: w.clientId,
      isEarly: false, canGenerate: true,
    });
    expect(rows[0].blockDueDate).toBe('2027-01-01');
  });
});

describe.runIf(enabled)('Prepaid Block renewal draft activation', () => {
  it('re-owns unexpired blocks to the matching line with reassignment audit rows, keeps the renewal start issuance and issues no contract_start', async () => {
    const w = await setup({ renewalTriggerOnRenewal: true });
    // Activation already scheduled the new line's start obligation.
    await db.transaction((trx) => syncPrepaidBlockIssuancesForContract(trx, tenant, w.renewalContractId));
    expect((await issuancesOf(w.renewalLineId)).map((r) => [r.trigger_kind, r.status])).toEqual([['renewal', 'scheduled']]);

    const live = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 120, expiration: '2027-06-30' });
    const livePending = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 600, expiration: '2027-09-30', status: 'pending' });
    const expired = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 30, expiration: '2020-01-01' });
    const adHoc = uuidv4();
    await db('hour_blocks').insert({
      block_id: adHoc, tenant, client_id: w.clientId, service_id: w.serviceId, total_minutes: 600, remaining_minutes: 600,
      hourly_rate: 10000, purchase_amount: 1, currency_code: 'EUR', status: 'active', purchased_at: '2026-06-01T00:00:00Z',
      source_type: 'purchase', expiration_date: null,
    });
    const expiryIssuance = uuidv4();
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: expiryIssuance, contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'expiry', due_date: '2027-06-30', status: 'scheduled', source_block_id: live,
    });

    const { completeRenewalQueueItemForActivation } = await import('../src/actions/renewalsQueueActions');
    const result = await completeRenewalQueueItemForActivation(w.clientContractId) as any;
    expect(result.status).toBe('completed');

    const moved = await db('hour_blocks').whereIn('block_id', [live, livePending]).orderBy('block_id');
    for (const block of moved) {
      expect(block.contract_line_id).toBe(w.renewalLineId);
      expect(block.client_contract_id).toBe(w.renewalClientContractId);
    }
    // No reset or extension.
    const liveRow = moved.find((b) => b.block_id === live)!;
    expect(liveRow.remaining_minutes).toBe(120);
    expect(dateOnly(liveRow.expiration_date)).toBe('2027-06-30');

    // Expired and ad-hoc blocks stay where they were.
    const stay = await db('hour_blocks').whereIn('block_id', [expired, adHoc]);
    expect(stay.find((b) => b.block_id === expired)).toMatchObject({ contract_line_id: w.lineId, client_contract_id: w.clientContractId });
    expect(stay.find((b) => b.block_id === adHoc)).toMatchObject({ contract_line_id: null, client_contract_id: null });

    const audits = await db('hour_block_audit').where({ tenant, type: 'reassignment' });
    expect(audits.map((a) => a.block_id).sort()).toEqual([live, livePending].sort());
    expect(audits[0].metadata).toMatchObject({
      from_contract_line_id: w.lineId, to_contract_line_id: w.renewalLineId,
      from_client_contract_id: w.clientContractId, to_client_contract_id: w.renewalClientContractId,
    });

    // Inherited blocks keep running AND the explicit renewal trigger still issues a new block on the
    // renewal date: exactly one scheduled `renewal` issuance, never a contract_start.
    const newLine = await issuancesOf(w.renewalLineId);
    expect(newLine.some((r) => r.trigger_kind === 'contract_start')).toBe(false);
    await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId));
    const afterSync = await issuancesOf(w.renewalLineId);
    expect(afterSync.filter((r) => r.status === 'scheduled').map((r) => [r.trigger_kind, dateOnly(r.due_date)]))
      .toEqual([['renewal', '2027-01-01']]);
    expect(afterSync.filter((r) => r.trigger_kind === 'renewal')).toHaveLength(1);

    // The moved block's expiry issuance follows it to the new line, superseded by the renewal block.
    expect(await db('contract_line_block_issuances').where({ tenant, issuance_id: expiryIssuance }).first())
      .toMatchObject({ status: 'superseded', contract_line_id: w.renewalLineId, cancel_reason: EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON });
    expect(afterSync.find((r) => r.status === 'scheduled')!.source_block_id).toBe(live);
  });

  it('moves the expiry issuance with its block when the new line has trigger_on_expiry', async () => {
    const w = await setup({ renewalTriggerOnExpiry: true });
    const live = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 120, expiration: '2027-06-30' });
    const expiryIssuance = uuidv4();
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: expiryIssuance, contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'expiry', due_date: '2027-06-30', status: 'scheduled', source_block_id: live,
    });
    await db.transaction((trx) => reownBlocksForRenewalActivation(trx, tenant, {
      sourceClientContractId: w.clientContractId, renewalContractId: w.renewalContractId, userId,
    }));
    expect(await db('contract_line_block_issuances').where({ tenant, issuance_id: expiryIssuance }).first())
      .toMatchObject({ status: 'scheduled', contract_line_id: w.renewalLineId, client_contract_id: w.renewalClientContractId });
  });

  it('does not re-own to a line with a different covered-service set; the blocks stay with the source (contract-end rule applies)', async () => {
    const w = await setup({ renewalLineServices: 'other' });
    const live = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 120, expiration: '2027-06-30' });
    const result = await db.transaction((trx) => reownBlocksForRenewalActivation(trx, tenant, {
      sourceClientContractId: w.clientContractId, renewalContractId: w.renewalContractId, userId,
    }));
    expect(result.reowned).toEqual([]);
    expect(result.unmatchedSourceLineIds).toEqual([w.lineId]);
    expect(await db('hour_blocks').where({ tenant, block_id: live }).first()).toMatchObject({ contract_line_id: w.lineId, client_contract_id: w.clientContractId });
    expect(await db('hour_block_audit').where({ tenant, type: 'reassignment' })).toHaveLength(0);
  });

  it('releases uninvoiced draws of source-line time from a re-owned block so it is billed normally, once', async () => {
    const w = await setup();
    const live = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 540, expiration: '2027-06-30' });
    const entryId = uuidv4();
    const start = new Date('2026-12-10T08:00:00.000Z');
    await db('time_entries').insert({
      entry_id: entryId, tenant, user_id: userId, service_id: w.serviceId, work_item_id: w.ticketId, work_item_type: 'ticket',
      start_time: start.toISOString(), end_time: new Date(start.getTime() + 60 * 60000).toISOString(),
      work_date: '2026-12-10', work_timezone: 'UTC', billable_duration: 60, approval_status: 'APPROVED', invoiced: false,
      contract_line_id: w.lineId,
    });
    await db('hour_block_time_allocations').insert({ tenant, block_id: live, time_entry_id: entryId, minutes: 60 });
    await db.transaction((trx) => reownBlocksForRenewalActivation(trx, tenant, {
      sourceClientContractId: w.clientContractId, renewalContractId: w.renewalContractId, userId,
    }));
    // Contract A's time no longer draws a block owned by contract B; the block got the minutes back.
    expect(await db('hour_block_time_allocations').where({ tenant, time_entry_id: entryId })).toHaveLength(0);
    expect((await db('hour_blocks').where({ tenant, block_id: live }).first()).remaining_minutes).toBe(600);
  });
});

describe.runIf(enabled)('Prepaid Block renewal contract start block', () => {
  it('detects a renewal contract through the source assignment\'s created_draft_contract_id', async () => {
    const w = await setup();
    await db.transaction(async (trx) => {
      expect(await isRenewalContract(trx, tenant, w.renewalContractId)).toBe(true);
      expect(await isRenewalContract(trx, tenant, w.contractId)).toBe(false);
    });
  });

  it('with trigger_on_renewal issues a renewal issuance at the start date, never contract_start', async () => {
    const w = await setup({ renewalTriggerOnRenewal: true });
    const first = await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId));
    expect(first).toMatchObject({ action: 'scheduled', dueDate: '2027-01-01' });
    expect(await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId))).toEqual({ action: 'none' });
    const rows = await issuancesOf(w.renewalLineId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger_kind: 'renewal', status: 'scheduled', client_contract_id: w.renewalClientContractId });

    // A start-date edit follows the not-yet-invoiced start obligation.
    await db('client_contracts').where({ tenant, client_contract_id: w.renewalClientContractId }).update({ start_date: '2027-01-15' });
    expect(await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId)))
      .toMatchObject({ action: 'rescheduled', dueDate: '2027-01-15' });
  });

  it('stays a renewal contract after the source cycle rolled (created_draft_contract_id nulled): re-sync never issues contract_start', async () => {
    const w = await setup({ renewalTriggerOnRenewal: false });
    await db('client_contracts').where({ tenant, client_contract_id: w.clientContractId }).update({ created_draft_contract_id: null });
    await db.transaction(async (trx) => {
      expect(await isRenewalContract(trx, tenant, w.renewalContractId)).toBe(true);
    });
    // Trigger off: nothing. Trigger on: a renewal, still never contract_start.
    await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId));
    expect(await issuancesOf(w.renewalLineId)).toHaveLength(0);
    await db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: w.renewalLineId }).update({ trigger_on_renewal: true });
    await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId));
    expect((await issuancesOf(w.renewalLineId)).map((r) => r.trigger_kind)).toEqual(['renewal']);
  });

  it('with trigger_on_renewal off issues no start issuance at all', async () => {
    const w = await setup({ renewalTriggerOnRenewal: false });
    expect(await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.renewalLineId))).toEqual({ action: 'none' });
    expect(await issuancesOf(w.renewalLineId)).toHaveLength(0);
  });

  it('a non-renewal contract still gets contract_start', async () => {
    const w = await setup();
    // Source contract A is not linked from any assignment as a renewal draft.
    const result = await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.lineId));
    expect(result).toMatchObject({ action: 'scheduled', dueDate: '2026-01-01' });
    expect((await issuancesOf(w.lineId))[0].trigger_kind).toBe('contract_start');
  });
});

describe.runIf(enabled)('Prepaid Block expiry issuance past contract end', () => {
  it('skips the expiry issuance when its due date is after the assignment end_date, and schedules it otherwise', async () => {
    const w = await setup({ endDate: '2027-03-31' });
    const blockId = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 600, expiration: '2027-12-31' });
    const schedule = (invoiceDate: string) => db.transaction((trx) => scheduleExpiryIssuanceForActivatedBlock(
      trx, tenant,
      { block_id: blockId, client_id: w.clientId, contract_line_id: w.lineId, client_contract_id: w.clientContractId },
      invoiceDate,
    ));
    // 2026-12-31 + 12 months = 2027-12-31 > 2027-03-31
    expect(await schedule('2026-12-31')).toBe('skipped_past_contract_end');
    expect(await issuancesOf(w.lineId)).toHaveLength(0);

    await db('client_contracts').where({ tenant, client_contract_id: w.clientContractId }).update({ end_date: '2027-12-31' });
    expect(await schedule('2026-12-31')).toBe('scheduled');
    expect(dateOnly((await issuancesOf(w.lineId))[0].due_date)).toBe('2027-12-31');
  });

  it('issuance sync cancels scheduled expiry (superseded) and renewal issuances due after the end date', async () => {
    const w = await setup({ endDate: '2027-03-31' });
    const live = await insertBlock(w, w.lineId, w.clientContractId, { remaining: 600, expiration: '2027-12-31' });
    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: uuidv4(), contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'expiry', due_date: '2027-12-31', status: 'scheduled', source_block_id: live,
    });
    await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.lineId));
    expect((await issuancesOf(w.lineId)).map((r) => [r.trigger_kind, r.status])).toEqual([['expiry', 'superseded']]);

    await db('contract_line_block_issuances').insert({
      tenant, issuance_id: uuidv4(), contract_line_id: w.lineId, client_contract_id: w.clientContractId,
      client_id: w.clientId, trigger_kind: 'renewal', due_date: '2027-06-30', status: 'scheduled',
    });
    await db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, tenant, w.lineId));
    expect((await issuancesOf(w.lineId)).map((r) => [r.trigger_kind, r.status]).sort())
      .toEqual([['expiry', 'superseded'], ['renewal', 'cancelled']]);
  });
});
