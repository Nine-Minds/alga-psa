/**
 * Read-only audit: contracts created by a quote conversion whose Fixed line
 * rate is the quoted UNIT price instead of quantity x unit price.
 *
 * Signature of the defect (fixed in shared/billingClients/quoteToContractLines.ts):
 * the workflow conversion path wrote `contract_lines.custom_rate =
 * quote_items.unit_price`, which the billing engine reads as the whole fee of
 * the line for one period, so a 10 x $50 quote line billed $50.
 *
 * The script only reads (one READ ONLY transaction, rolled back). It rewrites
 * nothing: how an affected contract is corrected — a pricing schedule from the
 * next period, an explicit line rate edit, a credit or a rebill of past periods
 * — is a per-contract decision for the operator.
 *
 * Usage:
 *   DB_HOST=... DB_PORT=... DB_NAME=... DB_USER_SERVER=... DB_PASSWORD_SERVER=... \
 *   npx tsx scripts/audit-quote-converted-contract-rates.ts
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import knexFactory, { type Knex } from 'knex';

const repositoryRoot = process.cwd();
dotenv.config({ path: path.resolve(repositoryRoot, '.env.localtest') });

function resolvePassword(envName: string, secretName: string, fallback: string): string {
  const configured = process.env[envName] || fallback;
  if (!configured.startsWith('/') && !configured.endsWith('.txt')) return configured;
  const candidates = [
    configured,
    path.resolve(repositoryRoot, 'secrets', path.basename(configured)),
    path.resolve(repositoryRoot, 'server/secrets', path.basename(configured)),
  ];
  for (const candidate of candidates) {
    try {
      const secret = fs.readFileSync(candidate, 'utf8').trim();
      if (secret) return secret;
    } catch {
      // Try the checkout-local secret mount before falling back to the value.
    }
  }
  try {
    return fs.readFileSync(path.resolve(repositoryRoot, 'secrets', secretName), 'utf8').trim();
  } catch {
    return configured;
  }
}

const databaseUrl = process.env.QUOTE_CONVERSION_AUDIT_DATABASE_URL || process.env.DATABASE_URL;
const connection: Knex.Config['connection'] = databaseUrl
  ? databaseUrl
  : {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME_SERVER || process.env.DB_NAME || 'server',
    user: process.env.DB_USER_SERVER || 'app_user',
    password: resolvePassword('DB_PASSWORD_SERVER', 'db_password_server', 'postpass123'),
    application_name: 'quote-converted-contract-rates-readonly-audit',
  };

const db = knexFactory({ client: 'pg', connection, pool: { min: 0, max: 1 } });

/** Only a tenant whose id is given is audited when the caller narrows the scope. */
const tenantFilter = process.env.QUOTE_CONVERSION_AUDIT_TENANT || null;

type AuditRow = {
  tenant: string;
  client_name: string | null;
  contract_id: string;
  contract_name: string | null;
  contract_status: string | null;
  source_quote_id: string;
  quote_number: string | null;
  contract_line_id: string;
  line_name: string | null;
  service_id: string;
  quantity: string | number;
  unit_price: string | number;
  stored_rate: string | number;
  invoiced_charges: string | number;
};

function cents(value: string | number): number {
  return Math.round(Number(value));
}

async function audit(): Promise<void> {
  const trx = await db.transaction();
  try {
    await trx.raw('SET TRANSACTION READ ONLY');

    const rows = await trx<unknown, AuditRow[]>('contracts as c')
      .select<AuditRow[]>(
        'c.tenant',
        'cl.client_name',
        'c.contract_id',
        'c.contract_name',
        'c.status as contract_status',
        'q.quote_number',
        'line.contract_line_id',
        'line.contract_line_name as line_name',
        'cls.service_id',
        'qi.quantity',
        'qi.unit_price',
        'line.custom_rate as stored_rate',
        trx.raw("c.template_metadata->>'source_quote_id' as source_quote_id"),
        // An invoice charge names the member configuration it billed, not the
        // line; count through the line's configuration rows.
        trx.raw(`(
          SELECT COUNT(*)
          FROM invoice_charge_details icd
          JOIN contract_line_service_configuration cfg
            ON cfg.tenant = icd.tenant AND cfg.config_id = icd.config_id
          WHERE icd.tenant = line.tenant AND cfg.contract_line_id = line.contract_line_id
        ) as invoiced_charges`),
      )
      .join('contract_lines as line', function () {
        this.on('line.contract_id', 'c.contract_id').andOn('line.tenant', 'c.tenant');
      })
      .join('contract_line_services as cls', function () {
        this.on('cls.contract_line_id', 'line.contract_line_id').andOn('cls.tenant', 'line.tenant');
      })
      .join('quotes as q', function () {
        this.on('q.tenant', 'c.tenant')
          .andOn(trx.raw("q.quote_id = (c.template_metadata->>'source_quote_id')::uuid"));
      })
      .join('quote_items as qi', function () {
        this.on('qi.tenant', 'q.tenant')
          .andOn('qi.quote_id', 'q.quote_id')
          .andOn('qi.service_id', 'cls.service_id');
      })
      .leftJoin('clients as cl', function () {
        this.on('cl.tenant', 'c.tenant').andOn('cl.client_id', 'c.owner_client_id');
      })
      .leftJoin('service_catalog as sc', function () {
        this.on('sc.tenant', 'cls.tenant').andOn('sc.service_id', 'cls.service_id');
      })
      .whereRaw("c.template_metadata->>'conversion_kind' = ?", ['quote_to_contract'])
      .where('line.contract_line_type', 'Fixed')
      .whereNotNull('line.custom_rate')
      .where('qi.is_recurring', true)
      .where('qi.quantity', '<>', 1)
      // A product line legitimately carries its unit price (its per-unit rate
      // lives on the member, the quantity on the configuration), so it is not
      // an instance of this defect.
      .whereRaw("coalesce(sc.item_kind, '') <> 'product'")
      .whereRaw("coalesce(qi.service_item_kind, '') <> 'product'")
      .modify((builder) => {
        if (tenantFilter) builder.where('c.tenant', tenantFilter);
      })
      .orderBy(['c.tenant', 'c.contract_name', 'line.contract_line_name']);

    // The comparison itself stays in JS: `custom_rate` is numeric and the quote
    // columns are bigint, and the expected value is the same rounding the
    // conversion now writes (Math.round(quantity x unit_price)).
    const affected = rows
      .map((row) => ({
        ...row,
        expected_cents: Math.round(Number(row.quantity) * Number(row.unit_price)),
        stored_cents: cents(row.stored_rate),
      }))
      .filter((row) => row.stored_cents !== row.expected_cents);

    if (affected.length === 0) {
      console.log('No quote-converted Fixed line carries a rate other than quantity x unit price.');
      return;
    }

    console.log(`${affected.length} quote-converted Fixed line(s) priced below the accepted quote:`);
    console.table(affected.map((row) => ({
      tenant: row.tenant,
      client: row.client_name,
      contract: row.contract_name,
      status: row.contract_status,
      quote: row.quote_number ?? row.source_quote_id,
      line: row.line_name,
      quantity: Number(row.quantity),
      unit_price_cents: cents(row.unit_price),
      stored_cents: row.stored_cents,
      expected_cents: row.expected_cents,
      under_billed_cents: row.expected_cents - row.stored_cents,
      invoiced_charges: Number(row.invoiced_charges),
      contract_line_id: row.contract_line_id,
    })));
    const alreadyBilled = affected.filter((row) => Number(row.invoiced_charges) > 0);
    console.log(
      `${alreadyBilled.length} of them have already billed at least one invoice charge; `
      + 'correcting a stored rate is a per-contract operator decision (this script changes nothing).',
    );
  } finally {
    await trx.rollback();
  }
}

audit()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
