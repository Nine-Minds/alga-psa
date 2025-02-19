import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { BillingCycleType } from '../src/interfaces/billing.interfaces';
import { TenantEntity } from '../src/interfaces/index';
import { ICompany, ICompanyLocation } from '../src/interfaces/company.interfaces';

/**
 * Creates a new tenant in the database
 * @param db Knex database instance
 * @param name Optional tenant name (defaults to "Test Tenant")
 * @returns The ID of the created tenant
 */
export async function createTenant(
  db: Knex,
  name: string = 'Test Tenant'
): Promise<string> {
  const tenantId = uuidv4();
  const now = new Date().toISOString();

  await db('tenants').insert({
    tenant: tenantId,
    created_at: now,
    updated_at: now,
  });

  return tenantId;
}

/**
 * Creates a new company in the database
 * @param db Knex database instance
 * @param tenantId ID of the tenant this company belongs to
 * @param name Optional company name (defaults to "Test Company")
 * @param options Optional additional company properties
 * @returns The ID of the created company
 */
export async function createCompany(
  db: Knex,
  tenantId: string,
  name: string = 'Test Company',
  options: Partial<ICompany> = {}
): Promise<string> {
  const companyId = uuidv4();
  const now = new Date().toISOString();

  const company: ICompany = {
    company_id: companyId,
    company_name: name,
    tenant: tenantId,
    billing_cycle: options.billing_cycle || 'monthly',
    is_tax_exempt: options.is_tax_exempt ?? false,
    phone_no: options.phone_no || '',
    email: options.email || '',
    url: options.url || '',
    address: options.address || '',
    created_at: now,
    updated_at: now,
    is_inactive: options.is_inactive ?? false,
    credit_balance: options.credit_balance ?? 0,
    client_type: options.client_type,
    tax_id_number: options.tax_id_number,
    notes: options.notes,
    notes_document_id: options.notes_document_id,
    properties: options.properties || {},
    payment_terms: options.payment_terms,
    credit_limit: options.credit_limit,
    preferred_payment_method: options.preferred_payment_method,
    auto_invoice: options.auto_invoice,
    invoice_delivery_method: options.invoice_delivery_method,
    tax_region: options.tax_region,
    tax_exemption_certificate: options.tax_exemption_certificate,
    timezone: options.timezone,
    invoice_template_id: options.invoice_template_id,
    billing_contact_id: options.billing_contact_id,
    billing_email: options.billing_email
  };

  await db('companies').insert(company);

  return companyId;
}

/**
 * Creates a new company location in the database
 * @param db Knex database instance
 * @param companyId ID of the company this location belongs to
 * @param tenantId ID of the tenant this location belongs to
 * @param options Optional location properties
 * @returns The ID of the created location
 */
export async function createCompanyLocation(
  db: Knex,
  companyId: string,
  tenantId: string,
  options: Partial<ICompanyLocation> = {}
): Promise<string> {
  const locationId = uuidv4();
  const now = new Date();

  const location: ICompanyLocation = {
    location_id: locationId,
    company_id: companyId,
    tenant: tenantId,
    address_line1: options.address_line1 || '123 Test St',
    address_line2: options.address_line2,
    city: options.city || 'Test City',
    state: options.state,
    postal_code: options.postal_code,
    country: options.country || 'US',
    tax_region: options.tax_region || 'US-NY',
    created_at: now,
    updated_at: now
  };

  await db('company_locations').insert(location);

  return locationId;
}

/**
 * Creates a new user in the database
 * @param db Knex database instance
 * @param tenantId ID of the tenant this user belongs to
 * @param options Optional user properties
 * @returns The ID of the created user
 */
export async function createUser(
  db: Knex,
  tenantId: string,
  options: {
    email?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    hashed_password?: string;
    user_type?: 'client' | 'internal';
    two_factor_enabled?: boolean;
    two_factor_secret?: string;
    is_google_user?: boolean;
    is_inactive?: boolean;
    contact_id?: string;
    phone?: string;
    timezone?: string;
  } = {}
): Promise<string> {
  const userId = uuidv4();
  const now = new Date();

  const user = {
    user_id: userId,
    tenant: tenantId,
    username: options.username || `test.user.${userId}`,
    first_name: options.first_name || 'Test',
    last_name: options.last_name || 'User',
    email: options.email || `test.user.${userId}@example.com`,
    hashed_password: options.hashed_password || 'hashed_password_here',
    created_at: now,
    two_factor_enabled: options.two_factor_enabled ?? false,
    two_factor_secret: options.two_factor_secret,
    is_google_user: options.is_google_user ?? false,
    is_inactive: options.is_inactive ?? false,
    user_type: options.user_type || 'internal',
    contact_id: options.contact_id,
    phone: options.phone,
    timezone: options.timezone
  };

  await db('users').insert(user);

  return userId;
}

/**
 * Creates a complete test environment with tenant, company, location, and user
 * @param db Knex database instance
 * @param options Optional properties for the created entities
 * @returns Object containing the created IDs
 */
export async function createTestEnvironment(
  db: Knex,
  options: {
    companyName?: string;
    userName?: string;
    billingCycle?: BillingCycleType;
  } = {}
): Promise<{
  tenantId: string;
  companyId: string;
  locationId: string;
  userId: string;
}> {
  const tenantId = await createTenant(db);
  const companyId = await createCompany(db, tenantId, options.companyName, {
    billing_cycle: options.billingCycle || 'monthly'
  });
  const locationId = await createCompanyLocation(db, companyId, tenantId);
  const userId = await createUser(db, tenantId, {
    username: options.userName
  });

  return { tenantId, companyId, locationId, userId };
}

/**
 * Helper function to generate a timestamp for test data
 * @param date Optional date to convert (defaults to current time)
 * @returns ISO string timestamp
 */
export function getTestTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}
