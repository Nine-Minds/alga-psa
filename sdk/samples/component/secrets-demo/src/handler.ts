import { ExecuteRequest, ExecuteResponse, jsonResponse } from './runtime.js';
import { get as getSecret } from 'alga:extension/secrets';

export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  const message = await getSecret('greeting').catch(() => 'hello');
  return jsonResponse({ message, path: request.http.url, config: request.context.config ?? {} });
}
