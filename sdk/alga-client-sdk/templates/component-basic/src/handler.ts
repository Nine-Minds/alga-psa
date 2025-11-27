import { ExecuteRequest, ExecuteResponse, jsonResponse } from '@alga-psa/extension-runtime';

export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  const { tenantId, extensionId } = request.context;
  return jsonResponse({
    ok: true,
    tenantId,
    extensionId,
    message: 'Hello from __PACKAGE_NAME__ component template.',
  });
}
