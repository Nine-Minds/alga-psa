/**
 * Permission Factory for E2E Tests
 * Creates permission test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface PermissionInput {
  tenant: string;
  permission_name?: string;
  description?: string;
  category?: string;
  is_system?: boolean;
}

export async function permissionFactory(db: any, input: PermissionInput) {
  const categories = ['project', 'ticket', 'user', 'team', 'report', 'billing', 'admin'];
  const actions = ['read', 'create', 'update', 'delete', 'approve', 'export'];
  
  // Generate a valid permission name if not provided
  let permissionName = input.permission_name;
  if (!permissionName) {
    const category = faker.helpers.arrayElement(categories);
    const action = faker.helpers.arrayElement(actions);
    permissionName = `${category}:${action}`;
  }

  const permission = {
    permission_id: faker.string.uuid(),
    tenant: input.tenant,
    permission_name: permissionName,
    description: input.description || `Permission for ${permissionName}`,
    category: input.category || permissionName.split(':')[0],
    is_system: input.is_system !== undefined ? input.is_system : false,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('permissions')
    .insert({
      permission_id: permission.permission_id,
      tenant: permission.tenant,
      permission_name: permission.permission_name,
      description: permission.description,
      category: permission.category,
      is_system: permission.is_system,
      created_at: permission.created_at,
      updated_at: permission.updated_at
    })
    .returning('*');

  return result[0];
}