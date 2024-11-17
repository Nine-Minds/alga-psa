import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { authorizationMiddleware } from './middleware/authorizationMiddleware';
import './lib/init/serverInit';  // Import server initialization

export const config = {
    matcher: [
        // Protected routes that require authentication
        '/msp/:path*',
        '/customer-portal/:path*',
        
        // Exclude auth and static routes
        '/((?!api/auth/(?!signin)|_next/static|_next/image|favicon.ico|auth|customer-portal/auth).*)',
    ],
};

export default withAuth(
    async function middleware(req) {
        const pathname = req.nextUrl.pathname;

        // Skip middleware for auth-related routes
        if (pathname.startsWith('/auth/') || pathname.startsWith('/customer-portal/auth/')) {
            return NextResponse.next();
        }

        // Get user type from token
        const userType = req.nextauth.token?.user_type as string;
        const isCustomerPortal = pathname.includes('/customer-portal');

        // Handle unauthenticated requests - always redirect to unified login
        if (!req.nextauth.token) {
            const url = new URL('/auth/signin', req.url);
            url.searchParams.set('callbackUrl', pathname);
            return NextResponse.redirect(url);
        }

        // Enforce access rules based on user type
        if (isCustomerPortal && userType !== 'client') {
            // Non-client users cannot access customer portal
            const url = new URL('/auth/signin', req.url);
            url.searchParams.set('error', 'AccessDenied');
            url.searchParams.set('callbackUrl', pathname);
            return NextResponse.redirect(url);
        }

        if (!isCustomerPortal && userType === 'client') {
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
        const tenantId = req.nextauth.token.tenant as string;
        if (tenantId) {
            response.headers.set('X-Cleanup-Connection', tenantId);
            response.headers.set('x-tenant-id', tenantId);
        }

        return response;
    },
    {
        callbacks: {
            authorized: ({ token, req }) => {
                // Allow access to auth pages without a token
                if (req.nextUrl.pathname.startsWith('/auth/') || 
                    req.nextUrl.pathname.startsWith('/customer-portal/auth/')) {
                    return true;
                }

                // For all other routes, require a token
                return !!token;
            },
        },
    }
);
