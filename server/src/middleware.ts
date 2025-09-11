import { NextResponse, NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Helper to check if path should skip API authentication
function shouldSkipApiAuth(pathname: string): boolean {
  const skipPaths = [
    '/api/auth/',
    '/api/health',
    '/api/healthz',
    '/api/readyz',
    '/api/documents/download/',
    '/api/documents/view/',
    '/api/email/webhooks/google',
    '/api/email/webhooks/microsoft',
    '/api/email/oauth/initiate'
  ];
  
  return skipPaths.some(path => pathname.startsWith(path));
}

// Mask API key for logging
function maskApiKey(key: string | null | undefined): string {
  if (!key) return 'none';
  const len = key.length;
  const prefix = key.slice(0, 4);
  const suffix = key.slice(Math.max(0, len - 2));
  return `${prefix}***${suffix} (len=${len})`;
}

// Handle API key authentication for API routes
async function handleApiKeyAuth(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  
  // Skip authentication for certain paths
  if (shouldSkipApiAuth(pathname)) {
    return NextResponse.next();
  }
  
  const apiKey = request.headers.get('x-api-key');
  const canary = request.headers.get('x-canary') || undefined;
  const tenantHeader = request.headers.get('x-tenant-id');
  
  // Log request (with masked key)
  console.log('[auth] incoming API request', JSON.stringify({
    path: pathname,
    hasApiKey: !!apiKey,
    apiKeyPreview: maskApiKey(apiKey),
    canary: canary || 'none',
    host: request.headers.get('host') || 'unknown'
  }));
  
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Unauthorized: API key missing' },
      { status: 401 }
    );
  }
  
  try {
    // Call internal validation endpoint
    const validateUrl = new URL('/api/auth/validate-key', request.url);
    const validateResponse = await fetch(validateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ apiKey, pathname })
    });
    
    if (!validateResponse.ok) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid API key' },
        { status: 401 }
      );
    }
    
    const result = await validateResponse.json();
    
    // Handle special keys (NM Store, Runner)
    if (result.special) {
      // Check if tenant header is required for NM Store
      if (result.type === 'nm_store' && pathname === '/api/v1/users/search' && !tenantHeader) {
        return NextResponse.json(
          { error: 'x-tenant-id header required for NM store key' },
          { status: 400 }
        );
      }
      
      // Allow request to proceed
      const response = NextResponse.next();
      if (tenantHeader) {
        response.headers.set('x-tenant-id', tenantHeader);
        response.headers.set('X-Cleanup-Connection', tenantHeader);
      }
      return response;
    }
    
    // Regular API key - add auth headers
    const { userId, tenant } = result;
    
    // Add authentication headers for downstream use
    const response = NextResponse.next();
    response.headers.set('x-auth-user-id', userId);
    response.headers.set('x-auth-tenant', tenant);
    
    // Add tenant headers
    if (tenant) {
      response.headers.set('X-Cleanup-Connection', tenant);
      response.headers.set('x-tenant-id', tenant);
    }
    
    return response;
  } catch (error) {
    console.error('Error validating API key:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// Handle session authentication for protected web routes
async function handleSessionAuth(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const secret = process.env.NEXTAUTH_SECRET;
  
  if (!secret) {
    console.error('NEXTAUTH_SECRET not configured');
    const url = new URL('/auth/msp/signin', request.url);
    url.searchParams.set('error', 'Configuration');
    return NextResponse.redirect(url);
  }
  
  // Get the session token
  const token = await getToken({ 
    req: request,
    secret
  });
  
  if (!token) {
    // No session, redirect to appropriate login page
    const callbackUrl = encodeURIComponent(request.url);
    const loginUrl = pathname.includes('/client-portal')
      ? `/auth/client-portal/signin?callbackUrl=${callbackUrl}`
      : `/auth/msp/signin?callbackUrl=${callbackUrl}`;
    
    return NextResponse.redirect(new URL(loginUrl, request.url));
  }
  
  // Check for token validation errors
  if ((token as any).error === "TokenValidationError") {
    const url = new URL('/auth/msp/signin', request.url);
    url.searchParams.set('error', 'SessionExpired');
    return NextResponse.redirect(url);
  }
  
  const userType = token.user_type as string;
  const tenant = token.tenant as string;
  const isClientPortal = pathname.includes('/client-portal');
  
  // Enforce portal access rules
  if (isClientPortal && userType !== 'client') {
    // Non-client users cannot access client portal
    const url = new URL('/auth/client-portal/signin', request.url);
    url.searchParams.set('error', 'AccessDenied');
    url.searchParams.set('callbackUrl', encodeURIComponent(request.url));
    return NextResponse.redirect(url);
  }
  
  if (!isClientPortal && userType === 'client') {
    // Client users cannot access MSP routes
    const url = new URL('/auth/msp/signin', request.url);
    url.searchParams.set('error', 'AccessDenied');
    url.searchParams.set('callbackUrl', encodeURIComponent(request.url));
    return NextResponse.redirect(url);
  }
  
  // Add tenant headers
  const response = NextResponse.next();
  if (tenant) {
    response.headers.set('X-Cleanup-Connection', tenant);
    response.headers.set('x-tenant-id', tenant);
  }
  
  return response;
}

// Main middleware function
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  
  // Handle API routes
  if (pathname.startsWith('/api/')) {
    // Skip auth endpoints entirely
    if (pathname.startsWith('/api/auth/')) {
      return NextResponse.next();
    }
    
    // Apply API key authentication
    return handleApiKeyAuth(request);
  }
  
  // Skip middleware for auth-related pages
  if (pathname.startsWith('/auth/') || 
      pathname.startsWith('/client-portal/auth/')) {
    return NextResponse.next();
  }
  
  // Handle protected web routes (MSP and Client Portal)
  if (pathname.startsWith('/msp/') || pathname.startsWith('/client-portal/')) {
    return handleSessionAuth(request);
  }
  
  // Allow all other routes
  return NextResponse.next();
}

// Configure which routes the middleware applies to
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files with extensions
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|public).*)',
  ]
};