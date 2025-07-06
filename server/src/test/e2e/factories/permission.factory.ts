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

  // Note: The permissions table only has permission_id, resource, action, and tenant columns
  const [resource, action] = permissionName.split(':');
  
  const permission = {
    permission_id: faker.string.uuid(),
    tenant: input.tenant,
    resource: resource,
    action: action
  };

  const result = await db('permissions')
    .insert(permission)
    .returning('*');

  return result[0];
}