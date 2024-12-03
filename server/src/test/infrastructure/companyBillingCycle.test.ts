import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createCompanyBillingCycles } from '@/lib/billing/createBillingCycles';
import { v4 as uuidv4 } from 'uuid';
import { formatISO, startOfDay } from 'date-fns';
import knex from 'knex';
import { TextEncoder } from 'util';
import dotenv from 'dotenv';

dotenv.config();
global.TextEncoder = TextEncoder;

let db: knex.Knex;
let companyId: string;

beforeAll(async () => {
  db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER_ADMIN,
      password: process.env.DB_PASSWORD_SERVER,
      database: process.env.DB_NAME_SERVER
    },
    migrations: { directory: "./migrations" },
    seeds: { directory: "./seeds/dev" }
  });
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  // Reset database
  await db.raw('DROP SCHEMA public CASCADE');
  await db.raw('CREATE SCHEMA public');
  await db.raw(`SET app.environment = '${process.env.APP_ENV}'`);
  await db.migrate.latest();
  await db.seed.run();
  
  // Clean up billing cycles
  await db('company_billing_cycles').del();

  // Create test company
  companyId = uuidv4();
  await db('companies').insert({
    company_id: companyId,
    tenant: '11111111-1111-1111-1111-111111111111',
    company_name: 'Test Company',
    billing_cycle: 'monthly',
    is_tax_exempt: false
  });
});

describe('Company Billing Cycle Creation', () => {
  it('creates a monthly billing cycle if none exists', async () => {
    // Verify no cycles exist initially
    const initialCycles = await db('company_billing_cycles')
      .where({ company_id: companyId })
      .orderBy('effective_date', 'asc');
    expect(initialCycles).toHaveLength(0);

    // Create billing cycles
    await createCompanyBillingCycles(db, {
      company_id: companyId,
      company_name: 'Test Company',
      billing_cycle: 'monthly',
      tenant: '11111111-1111-1111-1111-111111111111',
      phone_no: '',
      email: '',
      url: '',
      is_tax_exempt: false,
      tax_region: '',
      client_type: 'standard',
      notes: '',
      address: '',
      created_at: new Date().toISOString().split('T')[0] + 'T00:00:00Z',
      updated_at: new Date().toISOString().split('T')[0] + 'T00:00:00Z',
      is_inactive: false
    });

    // Verify cycles were created
    const cycles = await db('company_billing_cycles')
      .where({ company_id: companyId })
      .orderBy('effective_date', 'asc');

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({
      company_id: companyId,
      billing_cycle: 'monthly',
      tenant: '11111111-1111-1111-1111-111111111111'
    });

    // Verify period dates
    const cycle = cycles[0];
    expect(cycle.period_start_date).toBeDefined();
    expect(cycle.period_end_date).toBeDefined();
    
    // Verify period length is one month
    const startDate = new Date(cycle.period_start_date);
    const endDate = new Date(cycle.period_end_date);
    const monthDiff = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                     (endDate.getMonth() - startDate.getMonth());
    expect(monthDiff).toBe(1);
  });
});
