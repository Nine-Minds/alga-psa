/**
 * Schema for extension permission validation
 */
import { z } from 'zod';

// Standard permission structure: resource:action
const permissionPattern = /^([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)$/;

// Valid resources that extensions can request permissions for
export const validResources = [
  'extension',
  'ui',
  'storage',
  'data',
  'api',
  'ticket',
  'project',
  'company',
  'contact',
  'billing',
  'schedule',
  'document',
  'user',
  'time',
  'workflow',
] as const;

// Valid actions that extensions can perform
export const validActions = [
  'read',
  'write',
  'create',
  'update',
  'delete',
  'list',
  'view',
  'execute',
] as const;

// Schema for a single permission string
export const permissionSchema = z
  .string()
  .regex(
    permissionPattern,
    'Permission must be in format "resource:action" (e.g., "ticket:read")'
  )
  .refine(
    (permission) => {
      const [resource] = permission.split(':');
      return validResources.includes(resource as any);
    },
    {
      message: `Resource must be one of: ${validResources.join(', ')}`,
    }
  )
  .refine(
    (permission) => {
      const [, action] = permission.split(':');
      return validActions.includes(action as any);
    },
    {
      message: `Action must be one of: ${validActions.join(', ')}`,
    }
  );

// Schema for an array of permission strings
export const permissionsSchema = z.array(permissionSchema);

// Pre-defined permission sets that extensions can use
export const permissionSets = {
  BASIC: [
    'extension:read',
    'storage:read',
    'storage:write',
    'ui:view',
  ],
  TICKET_VIEWER: [
    'ticket:read',
    'ticket:list',
  ],
  TICKET_EDITOR: [
    'ticket:read',
    'ticket:list',
    'ticket:create',
    'ticket:update',
  ],
  BILLING_VIEWER: [
    'billing:read',
    'billing:list',
  ],
  REPORT_VIEWER: [
    'data:read',
    'data:list',
  ],
} as const;

// Helper function to get a permission set by name
export function getPermissionSet(name: keyof typeof permissionSets): string[] {
  return permissionSets[name];
}

// Helper to check if a permission is valid
export function isValidPermission(permission: string): boolean {
  return permissionSchema.safeParse(permission).success;
}

// Types for TypeScript
export type ValidResource = typeof validResources[number];
export type ValidAction = typeof validActions[number];
export type Permission = `${ValidResource}:${ValidAction}`;
export type PermissionSet = keyof typeof permissionSets;