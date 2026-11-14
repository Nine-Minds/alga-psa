import type { ReactNode } from 'react';
import type { ProductCode } from '@alga-psa/types';
import { notFound } from 'next/navigation';
import { getCurrentProductPrincipal } from '@/lib/productAccess';
import { type ProductRouteBehavior, resolveProductRouteBehavior } from '@/lib/productSurfaceRegistry';
import { ProductRouteBoundary } from '@/components/product/ProductRouteBoundary';

interface ResolveServerProductRouteInput {
  pathname: string;
}

interface ResolveServerProductRouteResult {
  productCode: ProductCode;
  behavior: ProductRouteBehavior;
  /** Present only for a user of a principal kind (a seat technician); an ordinary principal has none. */
  surfaceKind?: string;
}

export async function resolveServerProductRouteBehavior(
  input: ResolveServerProductRouteInput,
): Promise<ResolveServerProductRouteResult> {
  const principal = await getCurrentProductPrincipal();
  const behavior = resolveProductRouteBehavior(principal, input.pathname);

  return {
    productCode: principal.productCode,
    behavior,
    ...(principal.surfaceKind ? { surfaceKind: principal.surfaceKind } : {}),
  };
}

interface EnforceServerProductRouteInput {
  pathname: string;
  scope: 'msp' | 'client-portal';
}

export async function enforceServerProductRoute(
  input: EnforceServerProductRouteInput,
): Promise<ReactNode | null> {
  const { behavior } = await resolveServerProductRouteBehavior({ pathname: input.pathname });

  if (behavior === 'allowed') {
    return null;
  }

  if (behavior === 'not_found') {
    notFound();
  }

  return <ProductRouteBoundary behavior={behavior} scope={input.scope} />;
}
