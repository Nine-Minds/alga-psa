import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import knexFactory, { type Knex } from 'knex';

const repositoryRoot = process.cwd();
dotenv.config({ path: path.resolve(repositoryRoot, '.env.localtest') });

const tenantId = '6d178771-ad9a-4d43-8809-83992745f8f9';
const clientId = '5ba78228-ace1-4990-b42f-30739458299a';
const assignmentId = '4921ceb2-72f5-4f0a-afdc-da256e932c41';
const contractId = 'a5e37780-a9ba-4a35-a643-2233c25a5d0b';
const expectedDatabase = process.env.PR3499_FIXTURE_DB_NAME;

if (!expectedDatabase) {
  throw new Error('Set PR3499_FIXTURE_DB_NAME to the exact review database name before auditing.');
}
if (['prod', 'production', 'postgres', 'template0', 'template1'].includes(expectedDatabase.toLowerCase())) {
  throw new Error(`Refusing unsafe database name: ${expectedDatabase}`);
}

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

const databaseUrl = process.env.PR3499_FIXTURE_DATABASE_URL || process.env.DATABASE_URL;
const connection: Knex.Config['connection'] = databaseUrl
  ? databaseUrl
  : {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || expectedDatabase,
    user: process.env.DB_USER_SERVER || 'app_user',
    password: resolvePassword('DB_PASSWORD_SERVER', 'db_password_server', 'postpass123'),
    application_name: 'pr3499-unbilled-fixture-readonly-audit',
  };

const db = knexFactory({ client: 'pg', connection, pool: { min: 0, max: 1 } });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function count(
  trx: Knex.Transaction,
  table: string,
  query: (builder: Knex.QueryBuilder) => Knex.QueryBuilder,
): Promise<number> {
  const result = await query(trx(table).count('* as count')).first();
  return Number(result?.count ?? 0);
}

async function audit(): Promise<void> {
  const trx = await db.transaction();
  try {
    await trx.raw('SET TRANSACTION READ ONLY');
    const database = await trx.raw<{ rows: Array<{ name: string }> }>('SELECT current_database() AS name');
    const actualDatabase = database.rows[0]?.name;
    assert(actualDatabase === expectedDatabase,
      `Connected to database ${actualDatabase}, expected ${expectedDatabase}.`);

    const client = await trx('clients').where({ tenant: tenantId, client_id: clientId }).first('client_name');
    assert(client?.client_name === 'REVIEW-3499-UNBILLED-20261012-dcd6e36f',
      'The isolated PR #3499 fixture client is missing or has changed identity.');
    const assignment = await trx('client_contracts').where({
      tenant: tenantId, client_contract_id: assignmentId, client_id: clientId, is_active: true,
    }).first('client_contract_id');
    assert(assignment, 'The expected active client-contract assignment is missing.');

    const contractLineCount = await count(trx, 'contract_lines', (query) => query
      .where({ tenant: tenantId, contract_id: contractId })
      .whereIn('contract_line_id', [
        'dd5c2b59-a8b8-430d-a3ca-1bcc126dd997',
        '85923f68-0cfa-4a94-83c5-3eadd740978d',
      ]));
    assert(contractLineCount === 2, `Expected both copied contract lines; found ${contractLineCount}.`);

    const discountIds = [
      'c23f8952-378a-4de5-80d1-3f032396fec6',
      'f100f50c-4f9f-4d3a-ba5f-6d607ef3e605',
      '9365c6cc-c681-483c-bb96-63ce6dea0271',
    ];
    const discountCount = await count(trx, 'discounts', (query) => query
      .where({ tenant: tenantId, is_active: true }).whereIn('discount_id', discountIds));
    assert(discountCount === 3, `Expected all three active independent discount copies; found ${discountCount}.`);
    const assignmentDiscountCount = await count(trx, 'contract_discount_assignments', (query) => query
      .where({ tenant: tenantId, client_contract_id: assignmentId })
      .whereIn('discount_id', discountIds.slice(0, 2)));
    assert(assignmentDiscountCount === 2,
      `Expected copied 12% and fixed A$25 contract terms; found ${assignmentDiscountCount}.`);
    const lineDiscountCount = await count(trx, 'contract_line_discounts', (query) => query.where({
      tenant: tenantId,
      client_contract_id: assignmentId,
      discount_id: discountIds[2],
      contract_line_id: '85923f68-0cfa-4a94-83c5-3eadd740978d',
    }));
    assert(lineDiscountCount === 1, `Expected the copied 10% Cabling line term; found ${lineDiscountCount}.`);

    const eligiblePeriods = await trx('recurring_service_periods')
      .where({
        tenant: tenantId,
        period_key: 'period:2026-09-01:2026-10-01',
      })
      .whereIn('record_id', [
        'fe039803-e891-4faf-89d0-7b3ec84af1c5',
        'dea8e371-e639-4650-87a3-87fa8ce42f28',
      ])
      .whereRaw('invoice_window_start::date = ?::date', ['2026-10-01'])
      .whereRaw('invoice_window_end::date = ?::date', ['2026-11-01'])
      .whereNull('invoice_id')
      .whereNull('invoice_charge_detail_id')
      .select('record_id', 'period_key', 'lifecycle_state', 'invoice_window_start', 'invoice_window_end', 'invoice_id', 'invoice_charge_detail_id')
      .orderBy('record_id');
    assert(eligiblePeriods.length === 2,
      `Expected two unclaimed Sep 1–Oct 1 periods for Oct 1–Nov 1 invoice window; found ${eligiblePeriods.length}.`);

    const invoiceCount = await count(trx, 'invoices', (query) => query
      .where({ tenant: tenantId, client_id: clientId })
      .where('invoice_date', '>=', '2026-10-01')
      .where('invoice_date', '<', '2026-11-01'));
    assert(invoiceCount === 0, `The eligible invoice window was already claimed by ${invoiceCount} invoice(s).`);

    console.log(`Fixture audit passed in database ${actualDatabase}; candidate remains unbilled.`);
    console.table(eligiblePeriods.map((period) => ({
      ...period,
      invoice_window_start: period.invoice_window_start instanceof Date
        ? period.invoice_window_start.toISOString().slice(0, 10)
        : String(period.invoice_window_start).slice(0, 10),
      invoice_window_end: period.invoice_window_end instanceof Date
        ? period.invoice_window_end.toISOString().slice(0, 10)
        : String(period.invoice_window_end).slice(0, 10),
    })));
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
