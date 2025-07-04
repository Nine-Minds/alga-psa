/**
 * Role Factory for E2E Tests
 * Creates role test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface RoleInput {
  tenant: string;
  role_name?: string;
  description?: string;
  is_system?: boolean;
}

export async function roleFactory(db: any, input: RoleInput) {
  const role = {
    role_id: faker.string.uuid(),
    tenant: input.tenant,
    role_name: input.role_name || faker.person.jobTitle(),
    description: input.description || faker.lorem.sentence(),
    is_system: input.is_system !== undefined ? input.is_system : false,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('roles')
    .insert({
      role_id: role.role_id,
      tenant: role.tenant,
      role_name: role.role_name,
      description: role.description,
      is_system: role.is_system,
      created_at: role.created_at,
      updated_at: role.updated_at
    })
    .returning('*');

  return result[0];
}