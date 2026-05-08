import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getCurrentTenantProduct } from '@/lib/productAccess';
import { type ProductRouteBehavior, resolveProductRouteBehavior } from '@/lib/productSurfaceRegistry';
import { ProductRouteBoundary } from '@/components/product/ProductRouteBoundary';

interface ResolveServerProductRouteInput {
  pathname: string;
}

interface ResolveServerProductRouteResult {
  productCode: 'psa' | 'algadesk';
  behavior: ProductRouteBehavior;
}

export async function resolveServerProductRouteBehavior(
  input: ResolveServerProductRouteInput,
): Promise<ResolveServerProductRouteResult> {
  const productCode = await getCurrentTenantProduct();
  const behavior = resolveProductRouteBehavior(productCode, input.pathname);

  return { productCode, behavior };
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
