import { Request, Response, NextFunction } from 'express';
import { getToken, decode } from 'next-auth/jwt';
import { ApiKeyServiceForApi } from '../../lib/services/apiKeyServiceForApi';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider.js';

// Extend Express Request type to include Next.js-style properties
interface AuthenticatedRequest extends Request {
  nextUrl?: { pathname: string };
  user?: {
    id: string;
    tenant: string;
    userType: string;
  };
  apiKey?: {
    userId: string;
    tenant: string;
  };
}

/**
 * Helper function to adapt Express request for NextAuth getToken compatibility
 * NextAuth's getToken expects a Next.js-style request with cookies in a specific format
 */
function adaptRequestForNextAuth(expressReq: Request): any {
  const cookies = expressReq.cookies || {};
  
  // Create a minimal request object that NextAuth can understand
  // NextAuth primarily needs: cookies, headers, url, and method
  return {
    cookies,
    headers: expressReq.headers,
    url: expressReq.url,
    method: expressReq.method,
    // Add full URL for NextAuth token validation
    nextUrl: {
      pathname: expressReq.path,
      origin: `${expressReq.protocol}://${expressReq.get('host')}`,
      href: `${expressReq.protocol}://${expressReq.get('host')}${expressReq.originalUrl}`
    }
  };
}

/**
 * Alternative token parsing using NextAuth's decode function directly
 * This bypasses the getToken function and works directly with the JWT cookie
 */
async function getNextAuthToken(expressReq: Request, secret: string): Promise<any> {
  const cookies = expressReq.cookies || {};
  
  // Get the session token cookie
  const sessionToken = cookies['next-auth.session-token'] || cookies['__Secure-next-auth.session-token'];
  
  if (!sessionToken) {
    return null;
  }
  
  try {
    // Decode the JWT token directly
    const decoded = await decode({
      token: sessionToken,
      secret: secret
    });
    
    return decoded;
  } catch (error) {
    // Token decryption failed (likely wrong secret or corrupted token)
    return null;
  }
}

/**
 * Middleware to handle API key authentication for API routes
 * Replaces the HTTP round-trip with direct database validation
 */
export async function apiKeyAuthMiddleware(
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
) {
  // Only apply to API routes (excluding auth routes)
  if (!req.path.startsWith('/api') || req.path.startsWith('/api/auth/')) {
    return next();
  }

  // Skip authentication for health endpoints
  if (req.path === '/api/health') {
    return next();
  }

  // Skip authentication for document download and view endpoints (they use session auth)
  if (req.path.startsWith('/api/documents/download/') || req.path.startsWith('/api/documents/view/')) {
    return next();
  }

  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized: API key missing'
    });
  }

  try {
    // Direct database validation - eliminates HTTP round-trip
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    
    if (!keyRecord) {
      return res.status(401).json({
        error: 'Unauthorized: Invalid API key'
      });
    }

    // Add authentication info to request headers for downstream processing
    req.headers['x-auth-user-id'] = keyRecord.user_id;
    req.headers['x-auth-tenant'] = keyRecord.tenant;
    
    // Store in request object for middleware use
    req.apiKey = {
      userId: keyRecord.user_id,
      tenant: keyRecord.tenant
    };

    return next();
  } catch (error) {
    console.error('Error validating API key:', error);
    return res.status(500).json({
      error: 'Internal Server Error'
    });
  }
}

/**
 * Middleware to handle NextAuth session authentication for web routes
 * Preserves existing NextAuth integration
 */
export async function sessionAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  // Only apply to protected web routes (not API routes)
  if (req.path.startsWith('/api')) {
    return next();
  }

  // Skip authentication for auth-related routes
  if (req.path.startsWith('/auth/') || req.path.startsWith('/client-portal/auth/')) {
    return next();
  }

  // Only apply to routes that match our protected patterns
  const isProtectedRoute = req.path.startsWith('/msp/') || req.path.startsWith('/client-portal/');
  if (!isProtectedRoute) {
    return next();
  }

  try {
    // Get secret from provider only - the provider handles env vars and fallbacks
    const secretProvider = await getSecretProviderInstance();
    const nextAuthSecret = await secretProvider.getAppSecret('NEXTAUTH_SECRET');
    
    if (!nextAuthSecret) {
      console.error('NEXTAUTH_SECRET not available from secret provider');
      const callbackUrl = encodeURIComponent(req.originalUrl);
      return res.redirect(`/auth/signin?callbackUrl=${callbackUrl}`);
    }
    
    // Try alternative token parsing first
    let token = await getNextAuthToken(req, nextAuthSecret);
    
    // Fallback to original method if direct parsing fails
    if (!token) {
      const adaptedReq = adaptRequestForNextAuth(req);
      token = await getToken({ 
        req: adaptedReq, 
        secret: nextAuthSecret 
      });
    }
    
    if (!token) {
      // No session token, redirect to login
      const callbackUrl = encodeURIComponent(req.originalUrl);
      return res.redirect(`/auth/signin?callbackUrl=${callbackUrl}`);
    }

    const userType = token.user_type as string;
    const tenant = token.tenant as string;
    const isClientPortal = req.path.includes('/client-portal');

    // Enforce access rules based on user type
    if (isClientPortal && userType !== 'client') {
      // Non-client users cannot access client portal
      const callbackUrl = encodeURIComponent(req.originalUrl);
      return res.redirect(`/auth/signin?error=AccessDenied&callbackUrl=${callbackUrl}`);
    }

    if (!isClientPortal && userType === 'client') {
      // Client users cannot access MSP routes
      const callbackUrl = encodeURIComponent(req.originalUrl);
      return res.redirect(`/auth/signin?error=AccessDenied&callbackUrl=${callbackUrl}`);
    }

    // Store user info for downstream middleware
    req.user = {
      id: token.sub || '',
      tenant: tenant,
      userType: userType
    };

    return next();
  } catch (error) {
    console.error('Error validating session:', error);
    return res.redirect('/auth/signin');
  }
}

/**
 * Middleware to add tenant headers to responses
 * Preserves existing header injection behavior
 */
export function tenantHeaderMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  // Add tenant headers from either API key or session
  const tenant = req.apiKey?.tenant || req.user?.tenant;
  
  if (tenant) {
    res.setHeader('X-Cleanup-Connection', tenant);
    res.setHeader('x-tenant-id', tenant);
  }

  return next();
}

/**
 * Middleware to handle authorization checks
 * Ported from /server/src/middleware/authorizationMiddleware.ts
 * Only handles token validation and tenant header setting - permission checking happens in controllers
 */
export async function authorizationMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // Skip for health endpoints
    if (req.path === '/healthz' || req.path === '/readyz') {
      return next();
    }

    // Skip for auth endpoints  
    if (req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/')) {
      return next();
    }

    // Skip for public assets (matches Next.js middleware config)
    if (req.path.startsWith('/_next/static') || 
        req.path.startsWith('/_next/image') || 
        req.path === '/favicon.ico') {
      return next();
    }

    // For API routes, authentication is handled by apiKeyAuthMiddleware
    if (req.path.startsWith('/api/') && !req.path.startsWith('/api/auth/')) {
      return next();
    }

    // Get secret from provider only - the provider handles env vars and fallbacks
    const secretProvider = await getSecretProviderInstance();
    const nextAuthSecret = await secretProvider.getAppSecret('NEXTAUTH_SECRET');
    
    if (!nextAuthSecret) {
      console.error('NEXTAUTH_SECRET not available from secret provider');
      return res.redirect('/auth/signin');
    }
    
    // Get token for web routes (session-based) with adapted request
    const adaptedReq = adaptRequestForNextAuth(req);
    const token = await getToken({ 
      req: adaptedReq, 
      secret: nextAuthSecret 
    }) as { error?: string; tenant?: string } | null;

    // For web routes, validate session token
    if (!token) {
      // No token found, redirect to sign in (for web routes)
      return res.redirect('/auth/signin');
    }

    if (token.error === "TokenValidationError") {
      // Token validation failed, redirect to sign in
      return res.redirect('/auth/signin');
    }

    // Set the tenant based on the user's token (matching Next.js middleware behavior)
    if (token && token.tenant) {
      req.headers['x-tenant-id'] = token.tenant;
      return next();
    } else {
      // Handle the case where tenant is not in the token
      console.error('Tenant information not found in the token');
      return res.redirect('/auth/signin');
    }
  } catch (error) {
    console.error('Authorization middleware error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authorization check failed'
    });
  }
}