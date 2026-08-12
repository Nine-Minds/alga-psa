import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { knex, type Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { buildDeferredRevenueReport } from './compose';
import type { ClientRollforward, CurrencySection } from './types';

/**
 * Database-backed integration test for the deferred-revenue report.
 *
 * Connects to the worktree's dev database (DB_HOST / DB_PORT, defaulting to
 * the local dev stack), seeds a scratch tenant inside a single transaction,
 * and rolls the transaction back afterwards — nothing is persisted. Set
 * SKIP_DB_INTEGRATION_TESTS=true to skip when no database is reachable.
 */

const repoRoot = path.resolve(__dirname, '../../../../../..');
const SKIP = process.env.SKIP_DB_INTEGRATION_TESTS === 'true';

function readSecret(name: string): string {
  try {
    return readFileSync(path.join(repoRoot, 'secrets', name), 'utf8').trim();
  } catch {
    return '';
  }
}

const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = parseInt(process.env.DB_PORT || '6472', 10);
const dbUser = process.env.DB_USER_SERVER || 'app_user';
const dbPassword = readSecret('db_password_server');
const dbName = process.env.DB_NAME_SERVER || 'server';

const TENANT = uuidv4();

async function seedFixtures(trx: Knex.Transaction): Promise<{
  clientAId: string;
  clientBId: string;
  contractLineBucketMonthlyId: string;
}> {
  const clientAId = uuidv4();
  const clientBId = uuidv4();
  const contractId = uuidv4();
  const lineMonthlyId = uuidv4();
  const lineRolloverId = uuidv4();
  const serviceId = uuidv4();
  const serviceTypeId = uuidv4();
  const bucketConfigMonthlyId = uuidv4();
  const bucketConfigRolloverId = uuidv4();
  const fixedConfigMonthlyId = uuidv4();
  const invoiceFeeId = uuidv4();
  const invoicePrepayId = uuidv4();
  const feeChargeId = uuidv4();
  const feeDetailId = uuidv4();
  const now = new Date().toISOString();

  await trx('tenants').insert({
    tenant: TENANT,
    client_name: 'Deferred Revenue Integration',
    email: 'deferred-revenue@example.test',
    created_at: now,
    updated_at: now,
  });

  await trx('service_types').insert({
    id: serviceTypeId,
    tenant: TENANT,
    name: 'Block Hours',
    standard_service_type_id: null,
    is_active: true,
    order_number: 1,
  });

  await trx('service_catalog').insert({
    service_id: serviceId,
    tenant: TENANT,
    service_name: 'Engineering Block',
    description: 'Integration fixture',
    default_rate: 60000,
    billing_method: 'hourly',
    custom_service_type_id: serviceTypeId,
    item_kind: 'service',
    is_active: true,
    is_license: false,
  });

  for (const client of [
    { client_id: clientAId, client_name: 'Acme Corp' },
    { client_id: clientBId, client_name: 'Globex' },
  ]) {
    await trx('clients').insert({
      tenant: TENANT,
      client_id: client.client_id,
      client_name: client.client_name,
      client_type: 'company',
      is_tax_exempt: false,
      billing_cycle: 'monthly',
      default_currency_code: 'USD',
      lifecycle_status: 'active',
      created_at: now,
      updated_at: now,
    });
  }

  await trx('contracts').insert({
    tenant: TENANT,
    contract_id: contractId,
    contract_name: 'Support Contract',
    billing_frequency: 'monthly',
    status: 'active',
    is_template: false,
    currency_code: 'USD',
    is_system_managed_default: false,
    created_at: now,
    updated_at: now,
  });

  const insertLine = async (line: {
    contract_line_id: string;
    contract_line_name: string;
    contract_line_type: string;
    custom_rate?: number;
  }) => {
    await trx('contract_lines').insert({
      tenant: TENANT,
      contract_line_id: line.contract_line_id,
      contract_line_name: line.contract_line_name,
      billing_frequency: 'monthly',
      contract_line_type: line.contract_line_type,
      is_active: true,
      is_template: false,
      billing_timing: 'arrears',
      display_order: 0,
      enable_proration: false,
      billing_cycle_alignment: 'start',
      cadence_owner: 'client',
      contract_id: contractId,
      custom_rate: line.custom_rate ?? null,
      created_at: now,
      updated_at: now,
    });
  };

  await insertLine({
    contract_line_id: lineMonthlyId,
    contract_line_name: 'Monthly Block Hours',
    contract_line_type: 'Bucket',
  });
  await insertLine({
    contract_line_id: lineRolloverId,
    contract_line_name: 'Rollover Block Hours',
    contract_line_type: 'Bucket',
    custom_rate: 60000, // configured-fee fallback path (no invoice)
  });

  // Bucket config for the monthly line (100h, no rollover) plus a Fixed
  // config carrying the billed base fee.
  await trx('contract_line_service_configuration').insert({
    config_id: bucketConfigMonthlyId,
    tenant: TENANT,
    contract_line_id: lineMonthlyId,
    service_id: serviceId,
    configuration_type: 'Bucket',
    created_at: now,
    updated_at: now,
  });
  await trx('contract_line_service_bucket_config').insert({
    config_id: bucketConfigMonthlyId,
    tenant: TENANT,
    total_minutes: 6000,
    billing_period: 'monthly',
    overage_rate: 20000,
    allow_rollover: false,
    created_at: now,
    updated_at: now,
  });
  await trx('contract_line_service_configuration').insert({
    config_id: fixedConfigMonthlyId,
    tenant: TENANT,
    contract_line_id: lineMonthlyId,
    service_id: serviceId,
    configuration_type: 'Fixed',
    created_at: now,
    updated_at: now,
  });
  await trx('contract_line_service_fixed_config').insert({
    config_id: fixedConfigMonthlyId,
    tenant: TENANT,
    base_rate: 100000,
    created_at: now,
    updated_at: now,
  });

  // Bucket config for the rollover line (50h, rollover allowed).
  await trx('contract_line_service_configuration').insert({
    config_id: bucketConfigRolloverId,
    tenant: TENANT,
    contract_line_id: lineRolloverId,
    service_id: serviceId,
    configuration_type: 'Bucket',
    created_at: now,
    updated_at: now,
  });
  await trx('contract_line_service_bucket_config').insert({
    config_id: bucketConfigRolloverId,
    tenant: TENANT,
    total_minutes: 3000,
    billing_period: 'monthly',
    overage_rate: 20000,
    allow_rollover: true,
    created_at: now,
    updated_at: now,
  });

  // Finalized invoice billing the monthly line's Feb service period.
  await trx('invoices').insert({
    tenant: TENANT,
    invoice_id: invoiceFeeId,
    client_id: clientAId,
    invoice_number: 'INV-FEE-001',
    invoice_date: '2026-02-01T00:00:00.000Z',
    due_date: '2026-03-01T00:00:00.000Z',
    subtotal: 100000,
    tax: 0,
    total_amount: 100000,
    status: 'sent',
    finalized_at: '2026-02-01T00:00:00.000Z',
    is_prepayment: false,
    is_manual: true,
    currency_code: 'USD',
    invoice_type: 'standard',
    credit_applied: 0,
  });
  await trx('invoice_charges').insert({
    tenant: TENANT,
    item_id: feeChargeId,
    invoice_id: invoiceFeeId,
    service_id: serviceId,
    description: 'Monthly Block Hours',
    quantity: 1,
    unit_price: 100000,
    total_price: 100000,
    net_amount: 100000,
    tax_rate: 0,
    is_manual: true,
  });
  await trx('invoice_charge_details').insert({
    item_detail_id: feeDetailId,
    item_id: feeChargeId,
    tenant: TENANT,
    service_id: serviceId,
    config_id: fixedConfigMonthlyId,
    quantity: 1,
    rate: 100000,
    service_period_start: '2026-02-01',
    service_period_end: '2026-02-28',
    billing_timing: 'arrears',
  });

  // Prepayment invoice for the credit.
  await trx('invoices').insert({
    tenant: TENANT,
    invoice_id: invoicePrepayId,
    client_id: clientAId,
    invoice_number: 'INV-PP-001',
    invoice_date: '2026-01-05T00:00:00.000Z',
    due_date: '2026-01-05T00:00:00.000Z',
    subtotal: 5000,
    tax: 0,
    total_amount: 5000,
    status: 'sent',
    finalized_at: '2026-01-05T00:00:00.000Z',
    is_prepayment: true,
    is_manual: true,
    currency_code: 'USD',
    invoice_type: 'prepayment',
    credit_applied: 0,
  });

  // ── Credits ledger ─────────────────────────────────────────────────────
  const insertCreditTxn = async (over: {
    client_id: string;
    amount: number;
    type: string;
    created_at: string;
    invoice_id?: string;
    description?: string;
    related_transaction_id?: string;
  }) => {
    const [inserted] = await trx('transactions')
      .insert({
        tenant: TENANT,
        client_id: over.client_id,
        amount: over.amount,
        type: over.type,
        created_at: over.created_at,
        status: 'completed',
        description: over.description ?? over.type,
        currency_code: 'USD',
        invoice_id: over.invoice_id ?? null,
        related_transaction_id: over.related_transaction_id ?? null,
      })
      .returning('transaction_id');
    return inserted.transaction_id;
  };

  // Prepayment credit: 5000 granted in Jan, backed by the prepayment invoice.
  const prepayTxnId = await insertCreditTxn({
    client_id: clientAId,
    amount: 5000,
    type: 'credit_issuance',
    created_at: '2026-01-05T10:00:00.000Z',
    invoice_id: invoicePrepayId,
    description: 'Credit issued from prepayment',
  });
  await trx('credit_tracking').insert({
    tenant: TENANT,
    credit_id: uuidv4(),
    transaction_id: prepayTxnId,
    client_id: clientAId,
    amount: 5000,
    remaining_amount: 5000,
    created_at: '2026-01-05T10:00:00.000Z',
    is_expired: false,
    updated_at: now,
    currency_code: 'USD',
  });

  // Expired credit: 800 granted in Jan, expires in full in Feb.
  const expiredTxnId = await insertCreditTxn({
    client_id: clientAId,
    amount: 800,
    type: 'credit_issuance',
    created_at: '2026-01-10T10:00:00.000Z',
    description: 'Expiring grant',
  });
  await trx('credit_tracking').insert({
    tenant: TENANT,
    credit_id: uuidv4(),
    transaction_id: expiredTxnId,
    client_id: clientAId,
    amount: 800,
    remaining_amount: 0,
    created_at: '2026-01-10T10:00:00.000Z',
    expiration_date: '2026-02-15T00:00:00.000Z',
    is_expired: true,
    updated_at: now,
    currency_code: 'USD',
  });
  await insertCreditTxn({
    client_id: clientAId,
    amount: -800,
    type: 'credit_expiration',
    created_at: '2026-02-20T10:00:00.000Z',
    description: 'Credit expired',
    related_transaction_id: expiredTxnId,
  });

  // Applied credit: 2000 of the prepayment applied to an invoice in Feb.
  await insertCreditTxn({
    client_id: clientAId,
    amount: -2000,
    type: 'credit_application',
    created_at: '2026-02-10T10:00:00.000Z',
    description: 'Applied credit to invoice',
  });
  await trx('credit_tracking')
    .where({ transaction_id: prepayTxnId })
    .update({ remaining_amount: 3000, updated_at: now });

  // ── Bucket usage ───────────────────────────────────────────────────────
  // Monthly line: Feb 1–28, 2000 of 6000 minutes burned (partial burn).
  await trx('bucket_usage').insert({
    tenant: TENANT,
    usage_id: uuidv4(),
    contract_line_id: lineMonthlyId,
    client_id: clientAId,
    service_catalog_id: serviceId,
    period_start: '2026-02-01 00:00:00+00',
    period_end: '2026-02-28 00:00:00+00',
    minutes_used: 2000,
    overage_minutes: 0,
    rolled_over_minutes: 0,
  });

  // Rollover line, spanning month boundaries: period 1 (Jan 15 – Feb 14)
  // burns 2400 of 3000 → carries 600 to period 2 (Feb 15 – Mar 14), which
  // burns 900 of (3000 + 600).
  await trx('bucket_usage').insert({
    tenant: TENANT,
    usage_id: uuidv4(),
    contract_line_id: lineRolloverId,
    client_id: clientBId,
    service_catalog_id: serviceId,
    period_start: '2026-01-15 00:00:00+00',
    period_end: '2026-02-14 00:00:00+00',
    minutes_used: 2400,
    overage_minutes: 0,
    rolled_over_minutes: 0,
  });
  await trx('bucket_usage').insert({
    tenant: TENANT,
    usage_id: uuidv4(),
    contract_line_id: lineRolloverId,
    client_id: clientBId,
    service_catalog_id: serviceId,
    period_start: '2026-02-15 00:00:00+00',
    period_end: '2026-03-14 00:00:00+00',
    minutes_used: 900,
    overage_minutes: 0,
    rolled_over_minutes: 600,
  });

  return { clientAId, clientBId, contractLineBucketMonthlyId: lineMonthlyId };
}

function clientByName(section: CurrencySection, name: string): ClientRollforward {
  const client = section.clients.find((row) => row.clientName === name);
  if (!client) throw new Error(`client ${name} not in section`);
  return client;
}

describe.skipIf(SKIP)('deferred revenue report — database-backed integration', () => {
  it('rolls credits and hours forward across two months with the tie-out and carry invariants', async () => {
    if (!dbPassword) {
      throw new Error('Missing secrets/db_password_server — cannot reach the dev database');
    }

    const db: Knex = knex({
      client: 'pg',
      connection: {
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPassword,
        database: dbName,
      },
      pool: { min: 1, max: 2 },
    });

    try {
      const trx = await db.transaction();
      try {
        const { clientAId } = await seedFixtures(trx);

        // ── February rollforward ────────────────────────────────────────
        const feb = await buildDeferredRevenueReport(trx, TENANT, '2026-02');
        const usdFeb = feb.sections.find((section) => section.currencyCode === 'USD');
        expect(usdFeb).toBeDefined();

        const acme = clientByName(usdFeb!, 'Acme Corp');
        // Credits: opening 5000 + 800, applied -2000, expired -800 → 3000.
        expect(acme.credits.opening).toBe(5800);
        expect(acme.credits.applied).toBe(-2000);
        expect(acme.credits.expired).toBe(-800);
        expect(acme.credits.closing).toBe(3000);
        // Prepayment credit detail is flagged QBO-unreachable.
        expect(acme.creditDetails).toHaveLength(2);
        const prepayDetail = acme.creditDetails.find((detail) => detail.sourceKind === 'prepayment');
        expect(prepayDetail).toBeDefined();
        expect(prepayDetail!.qboReachable).toBe(false);
        expect(prepayDetail!.remainingAmount).toBe(3000);
        // Hours: monthly bucket (Feb 1–28) issued its fee, burned a partial
        // allowance, forfeited the rest at period end.
        expect(acme.hours.issued).toBe(100000);
        expect(acme.hours.applied).toBeCloseTo(-(2000 * (100000 / 6000)), 6);
        expect(acme.hours.closing).toBe(0);

        const globex = clientByName(usdFeb!, 'Globex');
        // Rollover bucket period 1 (Jan 15–Feb 14): opened at full allowance,
        // burn attributed to Feb (its end month), carry handed to period 2
        // (started Feb 15) so period 1 closes at zero. Period 2 (Feb 15–Mar
        // 14) issued its fee and stays active, its closing holding the carry.
        const rate = 60000 / 3000;
        expect(globex.hours.opening).toBe(3000 * rate);
        expect(globex.hours.issued).toBe(60000);
        expect(globex.hours.applied).toBe(-(2400 * rate));
        expect(globex.hours.expired).toBe(0);
        expect(globex.hours.closing).toBe((3000 + 600) * rate);
        expect(globex.bucketDetails).toHaveLength(2);

        // Tie-out invariant: closing credits ≡ derived available credit, as
        // availableCreditByClientQuery (packages/billing/src/lib/creditBalance.ts)
        // defines it — non-expired tracking rows whose expiration has not passed.
        const available = await trx('credit_tracking')
          .where({ tenant: TENANT, client_id: clientAId, is_expired: false })
          .where((qb) => {
            qb.whereNull('expiration_date').orWhere('expiration_date', '>', new Date().toISOString());
          })
          .sum({ total: 'remaining_amount' })
          .first();
        expect(Number(available?.total ?? 0)).toBe(acme.credits.closing);

        // ── March rollforward: closing(Feb) = opening(Mar) ─────────────
        const mar = await buildDeferredRevenueReport(trx, TENANT, '2026-03');
        const usdMar = mar.sections.find((section) => section.currencyCode === 'USD');
        expect(usdMar).toBeDefined();

        const acmeMar = clientByName(usdMar!, 'Acme Corp');
        expect(acmeMar.credits.opening).toBe(acme.credits.closing);
        expect(acmeMar.credits.closing).toBe(3000);
        expect(acmeMar.hours.opening).toBe(0);

        const globexMar = clientByName(usdMar!, 'Globex');
        expect(globexMar.hours.opening).toBe(globex.hours.closing);
        expect(globexMar.hours.issued).toBe(0);
        expect(globexMar.hours.applied).toBe(-(900 * rate));
        // Leftover 2700: 600 rolled-in minutes lapse, 2100 carry to April.
        expect(globexMar.hours.expired).toBe(-(600 * rate));
        expect(globexMar.hours.closing).toBe(2100 * rate);

        // The fallback note is disclosed because the rollover bucket spans
        // month boundaries.
        expect(feb.notes.length).toBeGreaterThan(0);
      } finally {
        // Never persist the scratch tenant: roll back unconditionally.
        await trx.rollback().catch(() => undefined);
      }
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  it('reconstructs month-M detail for a credit issued in M-1 and fully applied in M+1 (fix round 3)', async () => {
    if (!dbPassword) {
      throw new Error('Missing secrets/db_password_server — cannot reach the dev database');
    }

    const db: Knex = knex({
      client: 'pg',
      connection: {
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPassword,
        database: dbName,
      },
      pool: { min: 1, max: 2 },
    });

    try {
      const trx = await db.transaction();
      try {
        const clientId = uuidv4();
        const now = new Date().toISOString();
        await trx('tenants').insert({
          tenant: TENANT,
          client_name: 'Deferred Revenue Integration',
          email: 'deferred-revenue@example.test',
          created_at: now,
          updated_at: now,
        });
        await trx('clients').insert({
          tenant: TENANT,
          client_id: clientId,
          client_name: 'Acme Corp',
          client_type: 'company',
          is_tax_exempt: false,
          billing_cycle: 'monthly',
          default_currency_code: 'USD',
          lifecycle_status: 'active',
          created_at: now,
          updated_at: now,
        });

        const insertCreditTxn = async (over: {
          amount: number;
          type: string;
          created_at: string;
          description?: string;
          related_transaction_id?: string;
          metadata?: Record<string, unknown>;
        }) => {
          const [inserted] = await trx('transactions')
            .insert({
              tenant: TENANT,
              client_id: clientId,
              amount: over.amount,
              type: over.type,
              created_at: over.created_at,
              status: 'completed',
              description: over.description ?? over.type,
              currency_code: 'USD',
              invoice_id: null,
              related_transaction_id: over.related_transaction_id ?? null,
              metadata: over.metadata ?? null,
            })
            .returning('transaction_id');
          return inserted.transaction_id;
        };

        // Credit issued in M-1 (Jan), fully applied in M+1 (Mar). The current
        // tracking row says remaining 0 — the February report must still show
        // the full outstanding liability and reconcile detail to closing.
        const issuanceId = await insertCreditTxn({
          amount: 2000,
          type: 'credit_issuance',
          created_at: '2026-01-15T10:00:00.000Z',
          description: 'M-1 prepayment credit',
        });
        const creditId = uuidv4();
        await trx('credit_tracking').insert({
          tenant: TENANT,
          credit_id: creditId,
          transaction_id: issuanceId,
          client_id: clientId,
          amount: 2000,
          remaining_amount: 0,
          created_at: '2026-01-15T10:00:00.000Z',
          is_expired: false,
          updated_at: now,
          currency_code: 'USD',
        });
        await insertCreditTxn({
          amount: -2000,
          type: 'credit_application',
          created_at: '2026-03-10T10:00:00.000Z',
          description: 'M+1 full application',
          related_transaction_id: issuanceId,
          metadata: {
            applied_credits: [{ creditId, amount: 2000, transactionId: issuanceId }],
          },
        });

        const feb = await buildDeferredRevenueReport(trx, TENANT, '2026-02');
        const usdFeb = feb.sections.find((section) => section.currencyCode === 'USD');
        expect(usdFeb).toBeDefined();
        const acmeFeb = clientByName(usdFeb!, 'Acme Corp');
        expect(acmeFeb.credits.opening).toBe(2000);
        expect(acmeFeb.credits.closing).toBe(2000);
        expect(acmeFeb.creditDetails).toHaveLength(1);
        expect(acmeFeb.creditDetails[0].creditId).toBe(creditId);
        expect(acmeFeb.creditDetails[0].remainingAmount).toBe(2000);
        expect(
          acmeFeb.creditDetails.reduce((sum, detail) => sum + detail.remainingAmount, 0),
        ).toBe(acmeFeb.credits.closing);

        const mar = await buildDeferredRevenueReport(trx, TENANT, '2026-03');
        const usdMar = mar.sections.find((section) => section.currencyCode === 'USD');
        const acmeMar = clientByName(usdMar!, 'Acme Corp');
        expect(acmeMar.credits.closing).toBe(0);
        expect(acmeMar.creditDetails).toHaveLength(1);
        expect(acmeMar.creditDetails[0].remainingAmount).toBe(0);
        expect(
          acmeMar.creditDetails.reduce((sum, detail) => sum + detail.remainingAmount, 0),
        ).toBe(acmeMar.credits.closing);
      } finally {
        await trx.rollback().catch(() => undefined);
      }
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  it('restores a credit reversed by a FinancialService-shaped credit_adjustment with only related_transaction_id (fix round 3)', async () => {
    if (!dbPassword) {
      throw new Error('Missing secrets/db_password_server — cannot reach the dev database');
    }

    const db: Knex = knex({
      client: 'pg',
      connection: {
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPassword,
        database: dbName,
      },
      pool: { min: 1, max: 2 },
    });

    try {
      const trx = await db.transaction();
      try {
        const clientId = uuidv4();
        const now = new Date().toISOString();
        await trx('tenants').insert({
          tenant: TENANT,
          client_name: 'Deferred Revenue Integration',
          email: 'deferred-revenue@example.test',
          created_at: now,
          updated_at: now,
        });
        await trx('clients').insert({
          tenant: TENANT,
          client_id: clientId,
          client_name: 'Acme Corp',
          client_type: 'company',
          is_tax_exempt: false,
          billing_cycle: 'monthly',
          default_currency_code: 'USD',
          lifecycle_status: 'active',
          created_at: now,
          updated_at: now,
        });

        const insertCreditTxn = async (over: {
          amount: number;
          type: string;
          created_at: string;
          description?: string;
          related_transaction_id?: string;
          metadata?: Record<string, unknown>;
        }) => {
          const [inserted] = await trx('transactions')
            .insert({
              tenant: TENANT,
              client_id: clientId,
              amount: over.amount,
              type: over.type,
              created_at: over.created_at,
              status: 'completed',
              description: over.description ?? over.type,
              currency_code: 'USD',
              invoice_id: null,
              related_transaction_id: over.related_transaction_id ?? null,
              metadata: over.metadata ?? null,
            })
            .returning('transaction_id');
          return inserted.transaction_id;
        };

        // Credit issued in Jan, fully applied in Feb (canonical
        // metadata.applied_credits), then reversed in Mar the way
        // FinancialService.bulkTransactionOperation (reverse) writes it: a
        // credit_adjustment with only related_transaction_id → the original
        // application, and no metadata. Tracking is left at the stale 0 the
        // legacy writer leaves — the reconstruction must restore 2000 from the
        // ledger for the reversal month without trusting tracking.
        const issuanceId = await insertCreditTxn({
          amount: 2000,
          type: 'credit_issuance',
          created_at: '2026-01-15T10:00:00.000Z',
          description: 'Credit reversed via FinancialService',
        });
        const creditId = uuidv4();
        await trx('credit_tracking').insert({
          tenant: TENANT,
          credit_id: creditId,
          transaction_id: issuanceId,
          client_id: clientId,
          amount: 2000,
          remaining_amount: 0,
          created_at: '2026-01-15T10:00:00.000Z',
          is_expired: false,
          updated_at: now,
          currency_code: 'USD',
        });
        const applicationId = await insertCreditTxn({
          amount: -2000,
          type: 'credit_application',
          created_at: '2026-02-10T10:00:00.000Z',
          description: 'Full application',
          related_transaction_id: issuanceId,
          metadata: {
            applied_credits: [{ creditId, amount: 2000, transactionId: issuanceId }],
          },
        });
        await insertCreditTxn({
          amount: 2000,
          type: 'credit_adjustment',
          created_at: '2026-03-10T10:00:00.000Z',
          description: 'FinancialService reversal',
          related_transaction_id: applicationId,
        });

        const mar = await buildDeferredRevenueReport(trx, TENANT, '2026-03');
        const usdMar = mar.sections.find((section) => section.currencyCode === 'USD');
        expect(usdMar).toBeDefined();
        const acmeMar = clientByName(usdMar!, 'Acme Corp');
        expect(acmeMar.credits.closing).toBe(2000);
        expect(acmeMar.creditDetails).toHaveLength(1);
        expect(acmeMar.creditDetails[0].creditId).toBe(creditId);
        expect(acmeMar.creditDetails[0].remainingAmount).toBe(2000);
        expect(
          acmeMar.creditDetails.reduce((sum, detail) => sum + detail.remainingAmount, 0),
        ).toBe(acmeMar.credits.closing);
      } finally {
        await trx.rollback().catch(() => undefined);
      }
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});
