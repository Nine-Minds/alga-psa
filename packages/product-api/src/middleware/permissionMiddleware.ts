/**
 * Permission Middleware
 * Handles role-based access control (RBAC) for API endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@product/api/utils/response';

export type Permission = {
  resource: string;
  action: string;
};

export type PermissionCheck = (
  userId: string,
  tenantId: string,
  permission: Permission
) => Promise<boolean>;

/**
 * Create permission middleware for a specific resource and action
 */
export function withPermission(
  resource: string,
  action: string,
  permissionCheck?: PermissionCheck
) {
  return function permissionMiddleware(
    next: (request: NextRequest) => Promise<NextResponse>
  ) {
    return async function(request: NextRequest): Promise<NextResponse> {
      try {
        // Extract user context from request (should be set by auth middleware)
        const userId = (request as any).user?.id;
        const tenantId = (request as any).tenant?.id;

        if (!userId || !tenantId) {
          return createErrorResponse(
            'Authentication required',
            401,
            'UNAUTHORIZED'
          );
        }

        // Use custom permission check if provided, otherwise use default
        const hasPermission = permissionCheck 
          ? await permissionCheck(userId, tenantId, { resource, action })
          : await defaultPermissionCheck(userId, tenantId, { resource, action });

        if (!hasPermission) {
          return createErrorResponse(
            `Insufficient permissions for ${action} on ${resource}`,
            403,
            'FORBIDDEN'
          );
        }

        return next(request);
      } catch (error) {
        console.error('Permission check error:', error);
        return createErrorResponse(
          'Permission check failed',
          500,
          'INTERNAL_ERROR'
        );
      }
    };
  };
}

/**
 * Default permission check implementation
 * This should be replaced with actual RBAC logic
 */
async function defaultPermissionCheck(
  userId: string,
  tenantId: string,
  permission: Permission
): Promise<boolean> {
  // TODO: Implement actual permission checking logic
  // This could query the database for user roles and permissions
  // For now, return true to allow development to continue
  console.warn(`Permission check not implemented for ${permission.resource}:${permission.action}`);
  return true;
}

/**
 * Check if user has admin permissions
 */
export function withAdminPermission() {
  return withPermission('admin', 'access');
}

/**
 * Check if user can manage tenant settings
 */
export function withTenantManagement() {
  return withPermission('tenant', 'manage');
}