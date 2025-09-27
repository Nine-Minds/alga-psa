import { NextResponse } from 'next/server';
import { auth } from './app/api/auth/[...nextauth]/edge-auth';
import { i18nMiddleware, shouldSkipI18n } from './middleware/i18n';

// Minimal, Edge-safe middleware: API key header presence check for select API routes
// and auth gate for /msp paths, plus i18n locale resolution. Heavy logic stays in route handlers.
const protectedPrefix = '/msp';
const clientPortalPrefix = '/client-portal';
const canonicalUrlEnv = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL) : null;

const _middleware = auth((request) => {
  const pathname = request.nextUrl.pathname;
  const requestHost = request.headers.get('host') || '';
  const requestHostname = requestHost.split(':')[0];

  // Create a response that will be modified throughout the middleware chain
  let response = NextResponse.next();

  // Apply i18n middleware first (unless path should skip it)
  if (!shouldSkipI18n(pathname)) {
    const i18nResponse = i18nMiddleware(request);
    // Merge i18n response headers and cookies into our response
    if (i18nResponse instanceof NextResponse) {
      response = i18nResponse;
    }
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
      '/api/client-portal/domain-session'
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

  // Protect MSP app routes: validate user type
  if (pathname.startsWith(protectedPrefix)) {
    if (!request.auth) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/auth/signin';
      const callbackUrl = request.nextUrl.pathname + (request.nextUrl.search || '');
      loginUrl.searchParams.set('callbackUrl', callbackUrl);
      return NextResponse.redirect(loginUrl);
    } else if (request.auth.user?.user_type !== 'internal') {
      // Prevent non-internal users (clients) from accessing MSP portal
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/auth/signin';
      loginUrl.searchParams.set('error', 'AccessDenied');
      return NextResponse.redirect(loginUrl);
    }
  }

  // Protect Client Portal routes: validate user type (but not auth pages)
  if (pathname.startsWith(clientPortalPrefix) && !isAuthPage) {
    if (!request.auth) {
      const callbackUrlAbsolute = new URL(request.nextUrl.pathname + (request.nextUrl.search || ''), request.nextUrl);

      if (canonicalUrlEnv && requestHostname !== canonicalUrlEnv.hostname) {
        const canonicalLogin = new URL('/auth/client-portal/signin', canonicalUrlEnv.origin);
        const hostHeader = request.headers.get('host') || requestHostname;
        const protocol = request.nextUrl.protocol.replace(/:$/, '');
        const callbackUrl = `${protocol}://${hostHeader}${request.nextUrl.pathname}${request.nextUrl.search}`;
        canonicalLogin.searchParams.set('callbackUrl', callbackUrl);
        console.log('[middleware] vanity redirect', {
          requestHost: requestHostname,
          callback: callbackUrl,
          redirect: canonicalLogin.toString(),
        });
        return NextResponse.redirect(canonicalLogin);
      }

      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/auth/client-portal/signin';
      const existingCallback = request.nextUrl.searchParams.get('callbackUrl');
      if (existingCallback) {
        loginUrl.searchParams.set('callbackUrl', existingCallback);
      } else {
        loginUrl.searchParams.set('callbackUrl', callbackUrlAbsolute.pathname + callbackUrlAbsolute.search);
      }
      return NextResponse.redirect(loginUrl);
    } else if (request.auth.user?.user_type !== 'client') {
      // Prevent non-client users (internal) from accessing client portal
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/auth/client-portal/signin';
      loginUrl.searchParams.set('error', 'AccessDenied');
      return NextResponse.redirect(loginUrl);
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
