import { getSession } from '@alga-psa/auth';

import {
  assertTenantProductAccess,
  isProductAccessError,
  toProductAccessDeniedResponse,
} from '@/lib/productAccess';
import type { ProductCode } from '@alga-psa/types';

export async function assertSessionProductAccess(args: {
  capability: string;
  allowedProducts: readonly ProductCode[];
}): Promise<Response | null> {
  const session = await getSession();
  const tenantId = session?.user?.tenant;

  if (!tenantId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await assertTenantProductAccess({
      tenantId,
      capability: args.capability,
      allowedProducts: args.allowedProducts,
    });
    return null;
  } catch (error) {
    if (isProductAccessError(error)) {
      return toProductAccessDeniedResponse(error);
    }
    throw error;
  }
}
