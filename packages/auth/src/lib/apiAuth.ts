import { NextRequest } from 'next/server';
import { hasPermission } from './rbac';
import { IUser } from 'server/src/interfaces/auth.interfaces';

export interface AuthenticatedUser {
  userId: string;
  tenant: string;
}

/**
 * Get the authenticated user information from the request
 * This information is added by the middleware after validating the API key
 */
export function getAuthenticatedUser(req: NextRequest): AuthenticatedUser | null {
  const userId = req.headers.get('x-auth-user-id');
  const tenant = req.headers.get('x-auth-tenant');

  if (!userId || !tenant) {
    return null;
  }

  return {
    userId,
    tenant,
  };
}

/**
 * Ensure the request is authenticated and return the user information
 * Throws an error if the request is not authenticated
 */
export function requireAuthentication(req: NextRequest): AuthenticatedUser {
  const user = getAuthenticatedUser(req);
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

/**
 * Check if the authenticated user has the required permission
 * @param req The Next.js request object
 * @param resource The resource to check permission for
 * @param action The action to check permission for
 * @returns A promise that resolves to true if the user has permission, false otherwise
 */
export async function checkPermission(
  req: NextRequest,
  resource: string,
  action: string
): Promise<boolean> {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return false;
  }

  // Create a minimal user object that satisfies the IUser interface
  const userObj: IUser = {
    user_id: user.userId,
    username: '',  // These fields aren't used by hasPermission
    email: '',     // but are required by the interface
    hashed_password: '',
    is_inactive: false,
    tenant: user.tenant,
    user_type: 'internal', // Treat API-authenticated user as internal for RBAC
    created_at: new Date()
  };
  
  return hasPermission(userObj, resource, action);
}

/**
 * Ensure the authenticated user has the required permission
 * Throws an error if the user doesn't have permission
 */
export async function requirePermission(
  req: NextRequest,
  resource: string,
  action: string
): Promise<void> {
  const hasAccess = await checkPermission(req, resource, action);
  if (!hasAccess) {
    throw new Error('Forbidden');
  }
}

/**
 * Helper to create a standardized error response
 */
export function createErrorResponse(
  message: string,
  status: number = 400
): Response {
  return new Response(
    JSON.stringify({
      error: message
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
}

/**
 * Helper to create a standardized success response
 */
export function createSuccessResponse(
  data: any,
  status: number = 200
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
}
