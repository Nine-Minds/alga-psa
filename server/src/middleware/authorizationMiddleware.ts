import { NextRequest, NextResponse } from 'next/server';
import { getToken } from "next-auth/jwt"
import { JWT } from 'next-auth/jwt';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

interface CustomToken extends JWT {
  error?: string;
  isNineMindsUser?: boolean;
  roles?: string[];
  tenant?: string;
}

export async function authorizationMiddleware(req: NextRequest) {
  const secretProvider = await getSecretProviderInstance();
  const nextAuthSecret = (await secretProvider.getAppSecret('NEXTAUTH_SECRET')) || process.env.NEXTAUTH_SECRET || '';
  const token = await getToken({ req, secret: nextAuthSecret }) as CustomToken;

  if (!token) {
    // No token found, redirect to appropriate sign in page
    const isClientPortal = req.url.includes('/client-portal');
    if (isClientPortal) {
      return NextResponse.redirect(new URL('/auth/client-portal/signin', req.url));
    } else {
      return NextResponse.redirect(new URL('/auth/msp/signin', req.url));
    }
  }

  if (token.error === "TokenValidationError") {
    // Token validation failed, redirect to appropriate sign in page
    const isClientPortal = req.url.includes('/client-portal');
    if (isClientPortal) {
      return NextResponse.redirect(new URL('/auth/client-portal/signin', req.url));
    } else {
      return NextResponse.redirect(new URL('/auth/msp/signin', req.url));
    }
  }

  // Set the tenant based on the user's token
  if (token && token.tenant) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-tenant-id', token.tenant.toString());

    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    return response;
  } else {
    // Handle the case where tenant is not in the token
    console.error('Tenant information not found in the token');
    const isClientPortal = req.url.includes('/client-portal');
    if (isClientPortal) {
      return NextResponse.redirect(new URL('/auth/client-portal/signin', req.url));
    } else {
      return NextResponse.redirect(new URL('/auth/msp/signin', req.url));
    }
  }
}

// Create a middleware matcher configuration
export const config = {
  matcher: [
    // Match all routes except public assets and api routes
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

function getResourceTypeFromUrl(url: string): string {
  // TODO: Implement logic to extract resource type from URL
  return url.split('/')[1];
}

function getActionFromMethod(method: string): string {
  // TODO: Implement logic to map HTTP method to action
  return method;
}
