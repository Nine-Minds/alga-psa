/**
 * Shared Stripe offer catalog — `billing-catalog/offers/resolve` CE stub. Lazy-loads the EE route; CE builds have no catalog,
 * Stripe credentials or billing write path, so this answers 403 and does nothing else (F015).
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type EeRouteModule = { POST: (req: Request) => Promise<Response> };

let eeRouteModulePromise: Promise<EeRouteModule | null> | null = null;

async function loadEeRoute(): Promise<EeRouteModule | null> {
  if (!isEnterpriseEdition) return null;
  eeRouteModulePromise ??= import('@enterprise/app/api/v1/billing-catalog/offers/resolve/route')
    .then((module) => module as unknown as EeRouteModule)
    .catch((error) => {
      console.error('[v1/billing-catalog/offers/resolve] Failed to load EE route', error);
      return null;
    });
  return eeRouteModulePromise;
}

export async function POST(request: Request): Promise<Response> {
  const eeRoute = await loadEeRoute();
  if (!eeRoute?.POST) {
    if (isEnterpriseEdition) throw new Error('The Enterprise route failed to load.');
    return NextResponse.json({ error: 'The billing catalog requires Enterprise Edition.' }, { status: 403 });
  }
  return eeRoute.POST(request);
}
