import { buildThreecxCanonicalChat, validateThreecxReportChatBody } from '../reportChat';
import type { ThreecxRouteDeps } from './deps';
import { authenticateThreecxRequest as authenticate, invalidRequest, jsonResponse } from './authenticate';

/** POST report-chat: validate, mint the provider chat id, enqueue, answer 202. */
export async function handleThreecxReportChat(
  request: Request,
  tenantSlug: string,
  deps: ThreecxRouteDeps,
): Promise<Response> {
  const auth = await authenticate(request, tenantSlug, deps);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const validation = validateThreecxReportChatBody(body);
  if (!validation.ok) {
    return invalidRequest();
  }

  const chat = buildThreecxCanonicalChat(validation.value);
  await deps.enqueueChat({ tenantId: auth.ctx.tenantId, chat });

  return jsonResponse(202, { accepted: true, providerChatId: chat.providerChatId });
}
