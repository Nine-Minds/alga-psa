import { describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { activateHourBlocksForFinalizedInvoice } from '../src/actions/invoiceModification';
import { getAvailableHourBlockMinutes } from '@alga-psa/shared/billingClients/hourBlockService';

// Guarded DB test for the finalize-time sync between a draft hour-block
// purchase invoice and its pending block (29.8.18 Blocker 1, mitigation round
// 2). The invoice is editable before finalization, so the FINAL line is the
// authority: activation must sync the block to the edited line
// (qty/rate/service) via its explicit source_invoice_charge_id linkage, and a
// block whose linked line no longer survives as a positive charge on the
// finalized invoice must be VOIDED — never activated from a surviving line it
// cannot prove ownership of (removed line + foreign survivor, removed +
// re-added line, unresolvable linkage).

const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

interface Seed {
  invoiceId: string;
  blockId: string;
  itemId: string;
  clientId: string;
  serviceA: string;
  serviceB: string;
}

async function seed(db: Knex, tenant: string, overrides: { linkCharge?: boolean } = {}): Promise<Seed> {
  const clientId = uuidv4();
  const invoiceId = uuidv4();
  const blockId = uuidv4();
  const itemId = uuidv4();
  const serviceTypeId = uuidv4();
  const serviceA = uuidv4();
  const serviceB = uuidv4();
  await db('tenants').insert({ tenant, client_name: 'HB FinalizeSync Tenant', email: 'hbfd@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB FinalizeSync Client' });
  await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB FinalizeSync Type', is_active: true, order_number: 1 });
  for (const [serviceId, name] of [[serviceA, 'Sync Svc A'], [serviceB, 'Sync Svc B']] as const) {
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: name,
      custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
      unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
  }
  await db('invoices').insert({
    invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: `HB-SYNC-${invoiceId.slice(0, 8)}`,
    invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
    total_amount: 100000, subtotal: 100000, tax: 0, status: 'draft', is_manual: true, is_prepayment: false, credit_applied: 0,
  });
  await db('invoice_charges').insert({
    tenant, item_id: itemId, invoice_id: invoiceId, service_id: serviceA,
    description: 'Prepaid hour block — Sync Svc A', quantity: 10, unit_price: 10000,
    total_price: 100000, tax_rate: 0, is_manual: true,
  });
  await db('hour_blocks').insert({
    block_id: blockId, tenant, client_id: clientId, service_id: serviceA,
    total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 100000,
    currency_code: 'USD', status: 'pending', purchased_at: null, source_invoice_id: invoiceId,
    source_invoice_charge_id: overrides.linkCharge === false ? null : itemId,
    source_type: 'purchase',
  });
  return { invoiceId, blockId, itemId, clientId, serviceA, serviceB };
}

async function cleanup(db: Knex, tenant: string) {
  await db('hour_block_time_allocations').where({ tenant }).delete();
  await db('hour_block_service_scopes').where({ tenant }).delete();
  await db('hour_block_audit').where({ tenant }).delete();
  await db('hour_blocks').where({ tenant }).delete();
  await db('invoice_charges').where({ tenant }).delete();
  await db('invoices').where({ tenant }).delete();
  await db('service_catalog').where({ tenant }).delete();
  await db('service_types').where({ tenant }).delete();
  await db('clients').where({ tenant }).delete();
  await db('tenants').where({ tenant }).delete();
}

describe.runIf(enabled)('activateHourBlocksForFinalizedInvoice draft-edit sync (Blocker 2)', () => {
  it('edit-then-finalize: the activated block matches the edited line, not the original mint values', async () => {
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const tenant = uuidv4();
    const s = await seed(db, tenant);
    try {
      // Simulate the draft edit: 10h @ $100 on service A → 4h @ $150 on service B.
      await db('invoice_charges')
        .where({ tenant, item_id: s.itemId })
        .update({ quantity: 4, unit_price: 15000, service_id: s.serviceB, total_price: 60000 });

      await activateHourBlocksForFinalizedInvoice(s.invoiceId, db, tenant, uuidv4());

      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(block.status).toBe('active');
      expect(block.total_minutes).toBe(240);
      expect(block.remaining_minutes).toBe(240);
      expect(block.hourly_rate).toBe(15000);
      expect(block.purchase_amount).toBe(60000);
      expect(block.service_id).toBe(s.serviceB);
      expect(block.source_invoice_charge_id).toBe(s.itemId);
      expect(block.purchased_at).toBeTruthy();

      const audit = await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'purchase' }).first();
      expect(audit).toBeTruthy();
      expect(audit.metadata.source_invoice_charge_id).toBe(s.itemId);
      expect(audit.metadata.synced_from_line).toEqual({ item_id: s.itemId, quantity: 4, unit_price: 15000 });
    } finally {
      await cleanup(db, tenant);
      await db.destroy();
    }
  });

  it('remove-then-finalize: no block is activated for the removed line and no orphan pending block remains', async () => {
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const tenant = uuidv4();
    const s = await seed(db, tenant);
    try {
      await db('invoice_charges').where({ tenant, item_id: s.itemId }).delete();

      await activateHourBlocksForFinalizedInvoice(s.invoiceId, db, tenant, uuidv4());

      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(block.status).toBe('voided');
      expect(block.voided_at).toBeTruthy();
      expect(block.void_reason).toBe('Purchase line removed from the invoice before finalization');
      // Provenance is retained even though nothing was activated.
      expect(block.source_invoice_id).toBe(s.invoiceId);
      expect(block.total_minutes).toBe(600);

      const voidAudit = await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'void' }).first();
      expect(voidAudit).toBeTruthy();
      expect(voidAudit.reason).toBe('Purchase line removed from the invoice before finalization');

      // No purchase audit — the block never activated.
      expect(await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'purchase' }).first()).toBeFalsy();

      // No orphan pending block and nothing burnable.
      const orphaned = await db('hour_blocks')
        .where({ tenant, status: 'pending' })
        .whereNull('source_invoice_id')
        .count({ count: '*' })
        .first();
      expect(Number(orphaned?.count ?? 0)).toBe(0);
      expect(await getAvailableHourBlockMinutes(db, tenant, s.clientId)).toBe(0);
    } finally {
      await cleanup(db, tenant);
      await db.destroy();
    }
  });

  it('a line edited to a non-positive quantity voids the block instead of activating zero hours', async () => {
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const tenant = uuidv4();
    const s = await seed(db, tenant);
    try {
      await db('invoice_charges').where({ tenant, item_id: s.itemId }).update({ quantity: 0, total_price: 0 });

      await activateHourBlocksForFinalizedInvoice(s.invoiceId, db, tenant, uuidv4());

      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(block.status).toBe('voided');
      expect(block.void_reason).toBe('Purchase line no longer has a positive quantity at finalization');
      expect(await getAvailableHourBlockMinutes(db, tenant, s.clientId)).toBe(0);
    } finally {
      await cleanup(db, tenant);
      await db.destroy();
    }
  });

  it('removed line with a surviving foreign line: the block is voided, never bound to the surviving line (b2b3038e)', async () => {
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const tenant = uuidv4();
    const s = await seed(db, tenant);
    try {
      // The b2 reproduction shape: the block's purchase line (service A) is
      // removed from the draft — the FK's ON DELETE SET NULL erases the block's
      // linkage — while a DIFFERENT line (service B) survives. The deleted line
      // is indistinguishable from an unlinked legacy block, so any
      // surviving-line fallback would activate the block against a line it was
      // never minted against.
      await db('invoice_charges').where({ tenant, item_id: s.itemId }).delete();
      await db('invoice_charges').insert({
        tenant, item_id: uuidv4(), invoice_id: s.invoiceId, service_id: s.serviceB,
        description: 'Unrelated surviving line', quantity: 7, unit_price: 9000,
        total_price: 63000, tax_rate: 0, is_manual: true,
      });

      await activateHourBlocksForFinalizedInvoice(s.invoiceId, db, tenant, uuidv4());

      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(block.status).toBe('voided');
      expect(block.voided_at).toBeTruthy();
      // Never activated from the surviving foreign line: mint-time values kept.
      expect(block.total_minutes).toBe(600);
      expect(block.hourly_rate).toBe(10000);
      expect(block.service_id).toBe(s.serviceA);
      expect(block.source_invoice_charge_id).toBeNull();

      const voidAudit = await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'void' }).first();
      expect(voidAudit).toBeTruthy();
      expect(voidAudit.reason).toBe('Purchase line removed from the invoice before finalization');
      expect(voidAudit.metadata.source_invoice_charge_id).toBeNull();
      expect(await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'purchase' }).first()).toBeFalsy();

      expect(await getAvailableHourBlockMinutes(db, tenant, s.clientId)).toBe(0);
    } finally {
      await cleanup(db, tenant);
      await db.destroy();
    }
  });

  it('line removed and re-added with a new id: the block is voided, never bound to the re-added line', async () => {
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const tenant = uuidv4();
    const s = await seed(db, tenant);
    try {
      // Remove-then-re-add of the "same" purchase: the replacement line carries
      // a fresh item_id, so the block's linkage points at a dead row (nulled by
      // the FK) and cannot prove ownership of the new line.
      await db('invoice_charges').where({ tenant, item_id: s.itemId }).delete();
      const replacementId = uuidv4();
      await db('invoice_charges').insert({
        tenant, item_id: replacementId, invoice_id: s.invoiceId, service_id: s.serviceA,
        description: 'Prepaid hour block — Sync Svc A (re-added)', quantity: 5, unit_price: 12000,
        total_price: 60000, tax_rate: 0, is_manual: true,
      });

      await activateHourBlocksForFinalizedInvoice(s.invoiceId, db, tenant, uuidv4());

      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(block.status).toBe('voided');
      expect(block.source_invoice_charge_id).toBeNull();
      expect(block.total_minutes).toBe(600);
      expect(await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'purchase' }).first()).toBeFalsy();
      expect(await getAvailableHourBlockMinutes(db, tenant, s.clientId)).toBe(0);

      // No pending block lingers for the invoice either.
      const pending = await db('hour_blocks').where({ tenant, source_invoice_id: s.invoiceId, status: 'pending' }).count({ count: '*' }).first();
      expect(Number(pending?.count ?? 0)).toBe(0);
    } finally {
      await cleanup(db, tenant);
      await db.destroy();
    }
  });

  it('a pending block without resolvable linkage at finalize is voided, never activated from unproven line data', async () => {
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const tenant = uuidv4();
    // linkCharge: false leaves source_invoice_charge_id NULL — post-backfill
    // that is exactly the "lineage cannot be proven" shape (the FK nulls the
    // column on line deletion). Activation must not guess a line for it.
    const s = await seed(db, tenant, { linkCharge: false });
    try {
      await db('invoice_charges').where({ tenant, item_id: s.itemId }).update({ quantity: 2, unit_price: 5000, total_price: 10000 });

      await activateHourBlocksForFinalizedInvoice(s.invoiceId, db, tenant, uuidv4());

      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(block.status).toBe('voided');
      expect(block.total_minutes).toBe(600);
      expect(block.hourly_rate).toBe(10000);
      expect(await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'purchase' }).first()).toBeFalsy();
      expect(await getAvailableHourBlockMinutes(db, tenant, s.clientId)).toBe(0);
    } finally {
      await cleanup(db, tenant);
      await db.destroy();
    }
  });
});
