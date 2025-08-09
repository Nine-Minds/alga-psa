/**
 * Contact Factory for E2E Tests
 * Creates contact test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface ContactInput {
  tenant: string;
  company_id?: string;
  full_name?: string;
  email?: string;
  phone_number?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
}

export async function contactFactory(db: any, input: ContactInput) {
  const contact = {
    contact_name_id: faker.string.uuid(),
    tenant: input.tenant,
    company_id: input.company_id || null,
    full_name: input.full_name || faker.person.fullName(),
    email: input.email || faker.internet.email().toLowerCase(),
    phone_number: input.phone_number || faker.phone.number(),
    role: input.role || faker.person.jobTitle(),
    notes: input.notes || faker.lorem.sentence(),
    is_inactive: input.is_inactive !== undefined ? input.is_inactive : false,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('contacts')
    .insert({
      contact_name_id: contact.contact_name_id,
      tenant: contact.tenant,
      company_id: contact.company_id,
      full_name: contact.full_name,
      email: contact.email,
      phone_number: contact.phone_number,
      role: contact.role,
      notes: contact.notes,
      is_inactive: contact.is_inactive,
      created_at: contact.created_at,
      updated_at: contact.updated_at
    })
    .returning('*');

  return result[0];
}