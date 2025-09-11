import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Minimal middleware that only handles API authentication
 * Session authentication is handled by NextAuth itself
 */
export async function middleware(request: NextRequest) {
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
    
    if (skipPaths.some(path => pathname.startsWith(path))) {
      return NextResponse.next();
    }
    
    // For API routes that need authentication, check for API key
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Unauthorized: API key missing' },
        { status: 401 }
      );
    }
    
    // For now, pass through if API key exists
    // The actual validation happens in the API route handlers
    // This prevents Edge Runtime issues with database connections
  }
  
  // Let all other requests through
  // NextAuth handles session authentication for web routes automatically
  return NextResponse.next();
}

// Only apply middleware to API routes
export const config = {
  matcher: '/api/:path*'
};