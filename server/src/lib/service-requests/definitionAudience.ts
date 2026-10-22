import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Audience scoping for service-request definitions.
 *
 * This module is the single enforcement point (see
 * docs/plans/2026-10-22-service-requests-form-client-scoping.md §3):
 *   - `all`    -> everyone (default; existing forms are unchanged)
 *   - `scoped` -> only requesters whose client is listed, or whose contact is in a listed
 *                 client portal visibility group. `scoped` with no rows means NOBODY (fail closed).
 *
 * The audience is a live access policy on the definition. It is deliberately not
 * snapshotted into definition versions.
 *
 * Every query here is tenant-qualified via tenantDb; a loader that dropped `tenant` would
 * over-grant access.
 */

export type ServiceRequestAudienceMode = 'all' | 'scoped';

export interface ServiceRequestDefinitionAudience {
  mode: ServiceRequestAudienceMode;
  clientIds: string[];
  groupIds: string[];
}

export interface ServiceRequestAudienceRequester {
  clientId: string;
  contactId?: string | null;
}

export const EVERYONE_AUDIENCE: ServiceRequestDefinitionAudience = Object.freeze({
  mode: 'all' as const,
  clientIds: [] as string[],
  groupIds: [] as string[],
});

function normalizeMode(value: unknown): ServiceRequestAudienceMode {
  // Anything other than an explicit 'all' is treated as scoped so unknown values fail closed.
  return value === 'all' ? 'all' : 'scoped';
}

export async function loadDefinitionAudiences(
  knex: Knex | Knex.Transaction,
  tenant: string,
  definitionIds: string[]
): Promise<Map<string, ServiceRequestDefinitionAudience>> {
  const result = new Map<string, ServiceRequestDefinitionAudience>();
  if (definitionIds.length === 0) {
    return result;
  }
  const db = tenantDb(knex, tenant);

  const [definitionRows, clientRows, groupRows] = await Promise.all([
    db.table('service_request_definitions')
      .whereIn('definition_id', definitionIds)
      .select('definition_id', 'audience_mode') as Promise<
      Array<{ definition_id: string; audience_mode: string }>
    >,
    db.table('service_request_audience_clients')
      .whereIn('definition_id', definitionIds)
      .select('definition_id', 'client_id') as Promise<
      Array<{ definition_id: string; client_id: string }>
    >,
    db.table('service_request_audience_client_groups')
      .whereIn('definition_id', definitionIds)
      .select('definition_id', 'group_id') as Promise<
      Array<{ definition_id: string; group_id: string }>
    >,
  ]);

  for (const row of definitionRows) {
    result.set(row.definition_id, {
      mode: normalizeMode(row.audience_mode),
      clientIds: [],
      groupIds: [],
    });
  }
  for (const row of clientRows) {
    result.get(row.definition_id)?.clientIds.push(row.client_id);
  }
  for (const row of groupRows) {
    result.get(row.definition_id)?.groupIds.push(row.group_id);
  }
  return result;
}

/**
 * Loads one definition's audience. A definition that cannot be found in this tenant yields a
 * scoped/empty audience (nobody), never `all`.
 */
export async function loadDefinitionAudience(
  knex: Knex | Knex.Transaction,
  tenant: string,
  definitionId: string
): Promise<ServiceRequestDefinitionAudience> {
  const audiences = await loadDefinitionAudiences(knex, tenant, [definitionId]);
  return audiences.get(definitionId) ?? { mode: 'scoped', clientIds: [], groupIds: [] };
}

/**
 * Returns the contact's visibility group id, but only when the contact belongs to the
 * requester's client and the group belongs to that same client. Groups are per-client, so a
 * group from another client can never grant access.
 */
export async function loadContactVisibilityGroupId(
  knex: Knex | Knex.Transaction,
  tenant: string,
  requester: ServiceRequestAudienceRequester
): Promise<string | null> {
  if (!requester.contactId) {
    return null;
  }
  const db = tenantDb(knex, tenant);
  const contact = (await db.table('contacts')
    .where({ contact_name_id: requester.contactId, client_id: requester.clientId })
    .first('portal_visibility_group_id')) as { portal_visibility_group_id: string | null } | undefined;
  if (!contact?.portal_visibility_group_id) {
    return null;
  }
  const group = (await db.table('client_portal_visibility_groups')
    .where({ group_id: contact.portal_visibility_group_id, client_id: requester.clientId })
    .first('group_id')) as { group_id: string } | undefined;
  return group?.group_id ?? null;
}

export function isAudienceAllowed(params: {
  audience: ServiceRequestDefinitionAudience;
  clientId: string;
  contactGroupId: string | null;
}): boolean {
  const { audience, clientId, contactGroupId } = params;
  if (audience.mode === 'all') {
    return true;
  }
  if (clientId && audience.clientIds.includes(clientId)) {
    return true;
  }
  if (contactGroupId && audience.groupIds.includes(contactGroupId)) {
    return true;
  }
  return false;
}

/**
 * The single predicate: the existing visibility-provider result ANDed with the audience.
 */
export function isDefinitionVisibleToRequester(
  params: {
    audience: ServiceRequestDefinitionAudience;
    contactGroupId: string | null;
    context: { clientId: string; contactId?: string | null };
  },
  providerAllowed: boolean
): boolean {
  if (!providerAllowed) {
    return false;
  }
  return isAudienceAllowed({
    audience: params.audience,
    clientId: params.context.clientId,
    contactGroupId: params.contactGroupId,
  });
}
