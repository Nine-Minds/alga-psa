/**
 * Role Factory for E2E Tests
 * Creates role test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface RoleInput {
  tenant: string;
  role_name?: string;
  description?: string;
}

export async function roleFactory(db: any, input: RoleInput) {
  const role = {
    role_id: faker.string.uuid(),
    tenant: input.tenant,
    role_name: input.role_name || faker.person.jobTitle(),
    description: input.description || faker.lorem.sentence(),
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('roles')
    .insert(role)
    .returning('*');

  return result[0];
}