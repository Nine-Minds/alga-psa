import { NextResponse } from 'next/server';
import { auth } from './app/api/auth/[...nextauth]/edge-auth';
import { i18nMiddleware, shouldSkipI18n } from './middleware/i18n';

// Minimal, Edge-safe middleware: API key header presence check for select API routes
// and auth gate for /msp paths, plus i18n locale resolution. Heavy logic stays in route handlers.
const protectedPrefix = '/msp';
const clientPortalPrefix = '/client-portal';

// Helper function to get canonical URL (reads env var dynamically for testing)
function getCanonicalUrl(): URL | null {
  return process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL) : null;
}

const _middleware = auth((request) => {
  const pathname = request.nextUrl.pathname;
  const requestHost = request.headers.get('host') || '';
  const requestHostname = requestHost.split(':')[0];

  // Clone request headers so we can pass additional metadata downstream
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  // Create a response that will be modified throughout the middleware chain
  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Add pathname header for use in layouts (e.g., for branding injection)
  response.headers.set('x-pathname', pathname);

  // Apply i18n middleware first (unless path should skip it)
  if (!shouldSkipI18n(pathname)) {
    response = i18nMiddleware(request, response);
    // Ensure header persists after i18n adjustments
    response.headers.set('x-pathname', pathname);
  }

  // Only handle API routes that need API key authentication
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
    const apiKey = request.headers.get('x-api-key');

    // Skip paths that don't need API authentication
    const skipPaths = [
      '/api/health',
      '/api/healthz',
      '/api/readyz',
      '/api/documents/download/',
      '/api/documents/view/',
      '/api/email/webhooks/',
      '/api/email/oauth/',
      '/api/client-portal/domain-session',
      // Internal MSP UI endpoints (session-authenticated)
      '/api/accounting/csv/',
      '/api/webhooks/stripe',
      '/api/ext-proxy/'
    ];

    if (skipPaths.some((path) => pathname.startsWith(path))) {
      return response;
    }

    // For API routes that need authentication, check for API key presence only;
    // full validation happens in API route handlers (Node runtime)
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Unauthorized: API key missing' },
        { status: 401 }
      );
    }
  }

  // Skip auth pages to prevent redirect loops
  const isAuthPage = pathname.startsWith('/auth/');

  // Redirect vanity domains to canonical for client portal signin (before auth check)
  if (pathname === '/auth/client-portal/signin') {
    const canonicalUrlEnv = getCanonicalUrl();

    if (canonicalUrlEnv && requestHostname !== canonicalUrlEnv.hostname) {
      const canonicalLogin = new URL('/auth/client-portal/signin', canonicalUrlEnv.origin);
      const hostHeader = request.headers.get('host') || requestHostname;

      // Preserve existing query params (like callbackUrl)
      request.nextUrl.searchParams.forEach((value, key) => {
        canonicalLogin.searchParams.set(key, value);
      });

      // Add portalDomain for branding
      canonicalLogin.searchParams.set('portalDomain', hostHeader);

      console.log('[middleware] signin vanity redirect', {
        requestHost: requestHostname,
        canonicalHost: canonicalUrlEnv.hostname,
        redirect: canonicalLogin.toString(),
      });

      const redirectResponse = NextResponse.redirect(canonicalLogin);
      redirectResponse.headers.set('x-pathname', canonicalLogin.pathname);
      return redirectResponse;
    }
  }

  // Test bypass: allow MSP routes without auth when explicitly enabled for E2E
  if (process.env.E2E_AUTH_BYPASS === 'true' && pathname.startsWith(protectedPrefix)) {
    // If a tenantId is provided via query param, stamp it into request headers
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (tenantId) {
      response = NextResponse.next({
        request: {
          headers: new Headers({ ...Object.fromEntries(requestHeaders), 'x-tenant-id': tenantId }),
        },
      });
    }
    return response;
  }

  // Protect MSP app routes: validate user type
  if (pathname.startsWith(protectedPrefix)) {
    if (!request.auth) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/auth/signin';
      const callbackUrl = request.nextUrl.pathname + (request.nextUrl.search || '');
      loginUrl.searchParams.set('callbackUrl', callbackUrl);
      const redirectResponse = NextResponse.redirect(loginUrl);
      redirectResponse.headers.set('x-pathname', loginUrl.pathname);
      return redirectResponse;
    } else if (request.auth.user?.user_type !== 'internal') {
      // Redirect authenticated client users to their dashboard instead of trapping them in a login loop
      const canonicalUrlEnv = getCanonicalUrl();
      const redirectTarget = canonicalUrlEnv
        ? new URL('/client-portal/dashboard', canonicalUrlEnv.origin)
        : new URL('/client-portal/dashboard', request.nextUrl);
      const redirectResponse = NextResponse.redirect(redirectTarget);
      redirectResponse.headers.set('x-pathname', redirectTarget.pathname);
      return redirectResponse;
    }
  }

  // Protect Client Portal routes: validate user type (but not auth pages)
  if (pathname.startsWith(clientPortalPrefix) && !isAuthPage) {
    if (!request.auth) {
      const callbackUrlAbsolute = new URL(request.nextUrl.pathname + (request.nextUrl.search || ''), request.nextUrl);
      const canonicalUrlEnv = getCanonicalUrl();

      if (canonicalUrlEnv && requestHostname !== canonicalUrlEnv.hostname) {
        const canonicalLogin = new URL('/auth/client-portal/signin', canonicalUrlEnv.origin);
        const hostHeader = request.headers.get('host') || requestHostname;
        const protocol = request.nextUrl.protocol.replace(/:$/, '');
        const callbackUrl = `${protocol}://${hostHeader}${request.nextUrl.pathname}${request.nextUrl.search}`;
        canonicalLogin.searchParams.set('callbackUrl', callbackUrl);
        canonicalLogin.searchParams.set('portalDomain', hostHeader);
        console.log('[middleware] vanity redirect', {
          requestHost: requestHostname,
          callback: callbackUrl,
          redirect: canonicalLogin.toString(),
        });
        const redirectResponse = NextResponse.redirect(canonicalLogin);
        redirectResponse.headers.set('x-pathname', canonicalLogin.pathname);
        return redirectResponse;
      }

      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/auth/client-portal/signin';
      const existingCallback = request.nextUrl.searchParams.get('callbackUrl');
      if (existingCallback) {
        loginUrl.searchParams.set('callbackUrl', existingCallback);
      } else {
        loginUrl.searchParams.set('callbackUrl', callbackUrlAbsolute.pathname + callbackUrlAbsolute.search);
      }
      const redirectResponse = NextResponse.redirect(loginUrl);
      redirectResponse.headers.set('x-pathname', loginUrl.pathname);
      return redirectResponse;
    } else if (request.auth.user?.user_type !== 'client') {
      // Prevent non-client users (internal) from accessing client portal
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/auth/client-portal/signin';
      loginUrl.searchParams.set('error', 'AccessDenied');
      const redirectResponse = NextResponse.redirect(loginUrl);
      redirectResponse.headers.set('x-pathname', loginUrl.pathname);
      return redirectResponse;
    }
  }

  // Return the response with any i18n modifications
  return response;
});

export default _middleware;
export { _middleware as middleware };

export const config = {
  matcher: [
    '/msp/:path*',
    '/client-portal/:path*',
    '/((?!api|_next/static|_next/image|favicon.ico|public/).*)',
  ]
};
