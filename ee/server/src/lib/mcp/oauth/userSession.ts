import crypto from 'node:crypto';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { ApiCredentialsRefusedError, mayHoldApiCredentials } from '@alga-psa/authorization/subject/principalKind';

/**
 * Mint a short-lived USER-scoped API key for dispatching MCP tool calls under the
 * authenticated AlgaPSA user's own identity + RBAC. This is the Option-A analogue
 * of mintAgentSessionKey (agents.ts): the remote MCP connection acts as the user,
 * so we reuse the existing API-key → kernel RBAC path with the user's real user_id.
 */
export async function mintUserSessionKey(params: {
  tenant: string;
  userId: string;
  ttlSeconds?: number;
}): Promise<string> {
  const { tenant, userId } = params;
  const ttl = params.ttlSeconds ?? 300;
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    // MCP acts as the user: a principal kind that holds no API credentials (a seat technician) gets no session.
    if (!(await mayHoldApiCredentials(knex, { tenant, userId }))) throw new ApiCredentialsRefusedError('MCP is not available for this account');
    // Opportunistically sweep this tenant's expired MCP user session keys.
    await knex('api_keys')
      .where({ tenant, purpose: 'mcp_user' })
      .whereNotNull('expires_at')
      .where('expires_at', '<', knex.fn.now())
      .del();
    await knex('api_keys').insert({
      api_key: hash,
      user_id: userId,
      tenant,
      description: `mcp-user-session:${userId}`,
      purpose: 'mcp_user',
      active: true,
      usage_limit: null,
      expires_at: knex.raw(`now() + (? * interval '1 second')`, [ttl]),
    });
  });
  return token;
}
