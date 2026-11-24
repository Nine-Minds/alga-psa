'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  INBOUND_AUTH_TRUST_MODES,
  normalizeInboundAuthTrust,
  type InboundAuthTrustPolicy,
} from '@alga-psa/shared/lib/email/authResultsChain';

export interface InboundAuthTrustActionResult {
  success: boolean;
  error?: string;
  policy?: InboundAuthTrustPolicy;
}

// An authserv-id is a DNS-name-like token (RFC 8601): labels of letters, digits, `-`, `_`.
const AUTHSERV_ID_PATTERN = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/;
const MAX_AUTHSERV_IDS = 20;

async function canConfigureEmailProviders(user: any, knex: any): Promise<boolean> {
  return hasPermission(user, 'ticket_settings', 'update', knex);
}

export const getInboundAuthTrust = withAuth(async (
  user,
  { tenant },
  providerId: string
): Promise<InboundAuthTrustActionResult> => {
  const { knex } = await createTenantKnex();
  if (!(await canConfigureEmailProviders(user, knex))) {
    return { success: false, error: 'Permission denied' };
  }
  const row = await tenantDb(knex, tenant)
    .table('email_providers')
    .where({ id: providerId })
    .first('inbound_auth_trust');
  if (!row) return { success: false, error: 'Email provider not found' };
  return { success: true, policy: normalizeInboundAuthTrust(row.inbound_auth_trust) };
});

export const updateInboundAuthTrust = withAuth(async (
  user,
  { tenant },
  providerId: string,
  input: { mode: string; trustedAuthservIds?: string[] }
): Promise<InboundAuthTrustActionResult> => {
  const { knex } = await createTenantKnex();
  if (!(await canConfigureEmailProviders(user, knex))) {
    return { success: false, error: 'Permission denied' };
  }
  if (!(INBOUND_AUTH_TRUST_MODES as readonly string[]).includes(input?.mode)) {
    return { success: false, error: 'Invalid trust mode' };
  }
  const policy = normalizeInboundAuthTrust(input);
  if (policy.trustedAuthservIds.length > MAX_AUTHSERV_IDS) {
    return { success: false, error: `At most ${MAX_AUTHSERV_IDS} authserv-ids are allowed` };
  }
  const invalid = policy.trustedAuthservIds.find((id) => !AUTHSERV_ID_PATTERN.test(id));
  if (invalid) {
    return { success: false, error: `"${invalid}" is not a valid authserv-id (for example mx.example.net)` };
  }
  if (policy.mode !== 'off' && policy.trustedAuthservIds.length === 0) {
    return { success: false, error: 'Add at least one trusted authserv-id, or set the mode to Off' };
  }

  const updated = await tenantDb(knex, tenant)
    .table('email_providers')
    .where({ id: providerId })
    .update({ inbound_auth_trust: JSON.stringify(policy), updated_at: knex.fn.now() });
  if (!updated) return { success: false, error: 'Email provider not found' };
  return { success: true, policy };
});
