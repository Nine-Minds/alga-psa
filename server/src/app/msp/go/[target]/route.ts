import { NextResponse, type NextRequest } from 'next/server';
import { isProductNavTarget, resolveProductNavDestination } from '@alga-psa/types';
import { getCurrentTenantProduct } from '@/lib/productAccess';

export const dynamic = 'force-dynamic';

/**
 * Product-neutral navigation dispatcher.
 *
 * Links and OAuth `returnTo` values target `/msp/go/<target>`; this handler
 * resolves the caller's product and redirects to the page that product actually
 * exposes. See `PRODUCT_NAV_DESTINATIONS` in `@alga-psa/types` for the table and
 * for why the co-managed provider destination is not the PSA integrations page.
 *
 * A route handler rather than a page, so no client layout renders and no
 * product route boundary is evaluated against the dispatcher path itself. It
 * grants nothing: each destination keeps its own product route rule, and the
 * server actions behind each page keep their own RBAC and tenant-ownership
 * guards. An unknown target is a 404, not a redirect to an attacker-chosen
 * path.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ target: string }> },
): Promise<NextResponse> {
  const { target } = await context.params;
  if (!isProductNavTarget(target)) {
    return new NextResponse(null, { status: 404 });
  }

  const productCode = await getCurrentTenantProduct();
  const destination = resolveProductNavDestination(target, productCode);
  return NextResponse.redirect(new URL(destination, request.nextUrl.origin), {
    status: 307,
    headers: { 'Cache-Control': 'no-store' },
  });
}
