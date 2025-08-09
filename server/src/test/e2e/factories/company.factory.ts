/**
 * Company Factory for E2E Tests
 * Creates company test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface CompanyInput {
  tenant: string;
  company_name?: string;
  client_type?: 'company' | 'individual';
  email?: string;
  phone?: string;
  is_inactive?: boolean;
  url?: string;
  createLocation?: boolean;
}

export async function companyFactory(db: any, input: CompanyInput) {
  const company = {
    company_id: faker.string.uuid(),
    tenant: input.tenant,
    company_name: input.company_name || faker.company.name(),
    client_type: input.client_type || 'company',
    url: input.url || faker.internet.url(),
    is_inactive: input.is_inactive !== undefined ? input.is_inactive : false,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    credit_balance: 0,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('companies')
    .insert({
      company_id: company.company_id,
      tenant: company.tenant,
      company_name: company.company_name,
      client_type: company.client_type,
      url: company.url,
      is_inactive: company.is_inactive,
      billing_cycle: company.billing_cycle,
      is_tax_exempt: company.is_tax_exempt,
      credit_balance: company.credit_balance,
      created_at: company.created_at,
      updated_at: company.updated_at
    })
    .returning('*');

  const createdCompany = result[0];

  // Create a default location if email or phone is provided or if explicitly requested
  if (input.createLocation !== false && (input.email || input.phone)) {
    await db('company_locations').insert({
      location_id: faker.string.uuid(),
      company_id: createdCompany.company_id,
      tenant: input.tenant,
      location_name: 'Main Office',
      address_line1: faker.location.streetAddress(),
      city: faker.location.city(),
      state_province: faker.location.state({ abbreviated: true }),
      postal_code: faker.location.zipCode(),
      country_code: 'US',
      country_name: 'United States',
      email: input.email || faker.internet.email().toLowerCase(),
      phone: input.phone || faker.phone.number(),
      is_default: true,
      is_billing_address: true,
      is_shipping_address: true,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    });
  }

  return createdCompany;
}