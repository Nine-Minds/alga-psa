import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const timestamp = new Date().toISOString();
  
  // Log all API requests
  if (url.pathname.startsWith('/api/')) {
    console.log(`[MIDDLEWARE] ${timestamp} ${request.method} ${url.pathname}${url.search}`);
    console.log(`[MIDDLEWARE] Headers:`, Object.fromEntries(request.headers.entries()));
    
    // Add request ID for tracing
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    
    console.log(`[MIDDLEWARE] Request ID: ${requestId}`);
    
    return response;
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};