import { getSession } from '@alga-psa/auth';
import { assertTenantProductAccess, isProductAccessError, toProductAccessDeniedResponse } from '@/lib/productAccess';

export async function assertPsaChatProductAccess(): Promise<Response | null> {
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
      capability: 'ai_chat',
      allowedProducts: ['psa'],
    });
    return null;
  } catch (error) {
    if (isProductAccessError(error)) {
      return toProductAccessDeniedResponse(error);
    }
    throw error;
  }
}
