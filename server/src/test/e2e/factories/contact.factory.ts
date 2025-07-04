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

  const result = await db.query(
    `INSERT INTO contacts (
      contact_name_id, tenant, company_id, full_name, 
      email, phone_number, role, notes, is_inactive, 
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
    ) RETURNING *`,
    [
      contact.contact_name_id,
      contact.tenant,
      contact.company_id,
      contact.full_name,
      contact.email,
      contact.phone_number,
      contact.role,
      contact.notes,
      contact.is_inactive,
      contact.created_at,
      contact.updated_at
    ]
  );

  return result.rows[0];
}