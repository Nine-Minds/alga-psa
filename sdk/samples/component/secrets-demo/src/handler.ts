import { ExecuteRequest, ExecuteResponse, HostBindings, jsonResponse } from '@alga/extension-runtime';

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const message = await host.secrets.get('greeting').catch(() => 'hello');
  return jsonResponse({ message, path: request.http.url, config: request.context.config ?? {} });
}
