/**
 * Company Factory for E2E Tests
 * Creates company test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface CompanyInput {
  tenant: string;
  company_name?: string;
  company_type?: 'client' | 'partner' | 'vendor' | 'prospect';
  email?: string;
  phone?: string;
  is_inactive?: boolean;
}

export async function companyFactory(db: any, input: CompanyInput) {
  const company = {
    company_id: faker.string.uuid(),
    tenant: input.tenant,
    company_name: input.company_name || faker.company.name(),
    company_type: input.company_type || 'client',
    email: input.email || faker.internet.email().toLowerCase(),
    phone: input.phone || faker.phone.number(),
    is_inactive: input.is_inactive !== undefined ? input.is_inactive : false,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('companies')
    .insert({
      company_id: company.company_id,
      tenant: company.tenant,
      company_name: company.company_name,
      company_type: company.company_type,
      email: company.email,
      phone: company.phone,
      is_inactive: company.is_inactive,
      created_at: company.created_at,
      updated_at: company.updated_at
    })
    .returning('*');

  return result[0];
}