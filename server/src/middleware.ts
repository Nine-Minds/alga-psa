import { NextResponse, NextRequest } from 'next/server';
import { authorizationMiddleware } from './middleware/authorizationMiddleware';
import './lib/init/serverInit';  // Import server initialization
import { getToken } from 'next-auth/jwt';

// Handle API requests
async function handleApiRequest(request: NextRequest) {
  // Skip authentication for specific routes if needed
  if (request.nextUrl.pathname === '/api/health') {
    return NextResponse.next();
  }

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized: API key missing' }), 
      { 
        status: 401,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }

  try {
    // Call the API key validation endpoint
    const validateResponse = await fetch(new URL('/api/auth/validate-api-key', request.url), {
      method: 'POST',
      headers: {
        'x-api-key': apiKey
      }
    });

    if (!validateResponse.ok) {
      const { error } = await validateResponse.json();
      return new NextResponse(
        JSON.stringify({ error: `Unauthorized: ${error}` }), 
        { 
          status: validateResponse.status,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    const { userId, tenant } = await validateResponse.json();

    // Clone the request to modify headers
    const requestHeaders = new Headers(request.headers);
    
    // Add user and tenant information to request headers
    requestHeaders.set('x-auth-user-id', userId);
    requestHeaders.set('x-auth-tenant', tenant);
    
    // Create a new request with the modified headers
    const newRequest = new NextRequest(request.url, {
      headers: requestHeaders,
      method: request.method,
      body: request.body,
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal,
    });

    return NextResponse.next({
      request: newRequest,
    });
  } catch (error) {
    console.error('Error validating API key:', error);
    return new NextResponse(
      JSON.stringify({ error: 'Internal Server Error' }), 
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
}

// Main middleware function
export async function middleware(req: NextRequest) {
  // Handle API routes separately
  if (req.nextUrl.pathname.startsWith('/api')) {
    // Skip validation for auth endpoints
    if (req.nextUrl.pathname.startsWith('/api/auth/')) {
      return NextResponse.next();
    }
    return handleApiRequest(req);
  }

  const pathname = req.nextUrl.pathname;

  // Skip middleware for auth-related routes
  if (pathname.startsWith('/auth/') || 
      pathname.startsWith('/client-portal/auth/')) {
    return NextResponse.next();
  }

  // Get session token and validate using NextAuth directly
  const token = await getToken({ req });
  
  if (!token) {
    // No session token, redirect to login
    const url = new URL('/auth/signin', req.url);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  const userType = token.user_type as string;
  const tenant = token.tenant as string;
  const isClientPortal = pathname.includes('/client-portal');

  // Enforce access rules based on user type
  if (isClientPortal && userType !== 'client') {
    // Non-client users cannot access client portal
    const url = new URL('/auth/signin', req.url);
    url.searchParams.set('error', 'AccessDenied');
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  if (!isClientPortal && userType === 'client') {
    // Client users cannot access MSP routes
    const url = new URL('/auth/signin', req.url);
    url.searchParams.set('error', 'AccessDenied');
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  // Check additional authorization if needed
  const authorizationResult = await authorizationMiddleware(req);
  if (authorizationResult.status === 403) {
    return NextResponse.rewrite(new URL('/Denied', req.url));
  }

  // Add tenant headers
  const response = NextResponse.next();
  if (tenant) {
    response.headers.set('X-Cleanup-Connection', tenant);
    response.headers.set('x-tenant-id', tenant);
  }

  return response;
}

// Configure which routes the middleware applies to
export const config = {
  matcher: [
    // API routes
    '/api/:path*',
    
    // Protected routes that require authentication
    '/msp/:path*',
    '/client-portal/:path*',
    
    // Exclude auth and static routes
    '/((?!api/auth/(?!signin)|_next/static|_next/image|favicon.ico|auth|client-portal/auth).*)',
  ],
};
