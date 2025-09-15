import { NextResponse } from 'next/server';
import { auth } from './app/api/auth/[...nextauth]/edge-auth';

// Minimal, Edge-safe middleware: API key header presence check for select API routes
// and auth gate for /msp paths. Heavy logic stays in route handlers.
const protectedPrefix = '/msp';

const _middleware = auth((request) => {
  const pathname = request.nextUrl.pathname;

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
      '/api/email/oauth/'
    ];

    if (skipPaths.some((path) => pathname.startsWith(path))) {
      return NextResponse.next();
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

  // Protect MSP app routes: redirect unauthenticated users to sign-in
  if (pathname.startsWith(protectedPrefix)) {
    if (!request.auth) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/auth/signin';
      const callbackUrl = request.nextUrl.pathname + (request.nextUrl.search || '');
      loginUrl.searchParams.set('callbackUrl', callbackUrl);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Let all other requests through
  return NextResponse.next();
});

export default _middleware;
export { _middleware as middleware };

export const config = {
  matcher: ['/msp/:path*']
};

