import { NextRequest } from 'next/server';
import { hasPermission } from './rbac';
import { IUser } from 'server/src/interfaces/auth.interfaces';

export interface AuthenticatedUser {
  userId: string;
  tenant: string;
}

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

export function requireAuthentication(req: NextRequest): AuthenticatedUser {
  const user = getAuthenticatedUser(req);
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

export async function checkPermission(
  req: NextRequest,
  resource: string,
  action: string
): Promise<boolean> {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return false;
  }

  const userObj: IUser = {
    user_id: user.userId,
    username: '',
    email: '',
    hashed_password: '',
    is_inactive: false,
    tenant: user.tenant,
    user_type: 'internal',
    created_at: new Date()
  };

  return hasPermission(userObj, resource, action);
}

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
