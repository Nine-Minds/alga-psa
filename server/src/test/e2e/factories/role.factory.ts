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

  const result = await db.query(
    `INSERT INTO roles (
      role_id, tenant, role_name, description, 
      is_system, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7
    ) RETURNING *`,
    [
      role.role_id,
      role.tenant,
      role.role_name,
      role.description,
      role.is_system,
      role.created_at,
      role.updated_at
    ]
  );

  return result.rows[0];
}