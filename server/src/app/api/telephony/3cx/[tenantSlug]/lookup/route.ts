import { NextRequest } from 'next/server';
import { isEnterpriseEdition, eeUnavailable, telephonyOptionsResponse } from '../../../_ceStub';
import { buildThreecxRouteDeps } from '@/lib/telephony/threecxRouteDeps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The EE package (route handlers + route constants) is imported dynamically so
// the CE build never resolves it; the folder name fixes the route segment.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
  if (!isEnterpriseEdition) {
    return eeUnavailable();
  }
  const { tenantSlug } = await context.params;
  const { handleThreecxLookup } = await import('@alga-psa/ee-threecx/lib');
  return handleThreecxLookup(request, tenantSlug, buildThreecxRouteDeps());
}

export async function OPTIONS(): Promise<Response> {
  return telephonyOptionsResponse('GET, OPTIONS');
}
