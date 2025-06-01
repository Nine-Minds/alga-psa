/**
 * Authentication Middleware
 * Validates authentication tokens and ensures user access
 */

import { NextApiRequest, NextApiResponse } from 'next';

export interface AuthenticatedRequest extends NextApiRequest {
  user?: {
    id: string;
    tenant: string;
    email: string;
    roles: string[];
  };
}

export function withAuth(handler: (req: AuthenticatedRequest, res: NextApiResponse) => Promise<void> | void) {
  return async (req: AuthenticatedRequest, res: NextApiResponse) => {
    try {
      // TODO: Implement actual authentication logic
      // This would typically validate JWT tokens, check session, etc.
      
      // For now, mock authentication for development
      if (process.env.NODE_ENV === 'development') {
        req.user = {
          id: 'mock-user-id',
          tenant: 'mock-tenant-id',
          email: 'user@example.com',
          roles: ['admin']
        };
      } else {
        // In production, implement proper auth validation
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication token required'
          });
        }

        // TODO: Validate the token and extract user info
        // const token = authHeader.substring(7);
        // const user = await validateToken(token);
        // req.user = user;
      }

      return handler(req, res);
    } catch (error: any) {
      console.error('Authentication error:', error);
      return res.status(401).json({
        error: 'Authentication failed',
        message: error.message
      });
    }
  };
}