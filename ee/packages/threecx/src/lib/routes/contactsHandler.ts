import { createContactFromThreecx, validateThreecxCreateContactBody } from '../contacts';
import type { ThreecxRouteDeps } from './deps';
import { authenticateThreecxRequest, invalidRequest, jsonResponse } from './authenticate';

/**
 * POST /api/telephony/3cx/[tenantSlug]/contacts — the client's create-contact
 * action. Every outcome (created, duplicate email, pending without an email)
 * answers 200 with one Contact so 3CX opens its ContactUrl.
 */
export async function handleThreecxCreateContact(
  request: Request,
  tenantSlug: string,
  deps: ThreecxRouteDeps,
): Promise<Response> {
  const auth = await authenticateThreecxRequest(request, tenantSlug, deps);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const validation = validateThreecxCreateContactBody(body);
  if (!validation.ok) {
    return invalidRequest(validation.message);
  }

  const result = await createContactFromThreecx(
    { tenantId: auth.ctx.tenantId, baseUrl: auth.ctx.baseUrl },
    validation.value,
  );
  return jsonResponse(200, { contacts: [result.contact] });
}
