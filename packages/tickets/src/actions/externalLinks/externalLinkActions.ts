'use server';

import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type {
  ExternalEntityLinkEntityType,
  ExternalLinkRelationship,
  ExternalSystemActor,
  IExternalEntityLink,
  ITenantExternalSystem,
  IUserWithRoles,
} from '@alga-psa/types';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import {
  listExternalSystems as buildSystemDefinitions,
  renderExternalLinkUrl,
  resolveExternalSystem,
  safeExternalUrl,
} from '../../lib/externalSystems';
import { CUSTOM_EXTERNAL_SYSTEM_KEY_PATTERN } from '@alga-psa/types';
import { authorizeTicketRecordAccess } from '../../lib/ticketRecordAuthorization';
import {
  ExternalLinkValidationError,
  assertLinkDestination,
  insertExternalLink,
  loadTenantExternalSystems,
  prepareExternalLink,
  publishExternalLinkEvent,
  type AddExternalLinkInput,
  type UpdateExternalLinkPatch,
} from './externalLinkPersistence';
import {
  externalLinkActionError,
  externalLinkActionErrorFrom,
  type ExternalLinkActionError,
} from './externalLinkErrors';

/**
 * Ticket/comment external system links.
 *
 * Read is gated by `ticket:read`; mutation by `ticket:update`. Comment links
 * authorize against the owning ticket. Event publishing is deferred to after
 * the transaction commits and is best-effort — a broker outage must not roll
 * back a persisted link.
 */

export interface ExternalLinkDisplay {
  /** Readable system name (never a raw key). */
  label: string;
  icon: string;
  /** Resolved link-out, or null when there is nothing safe to open. */
  href: string | null;
  /** Human label for the realm field, when the system declares one. */
  realmLabel: string | null;
}

export interface ITicketExternalLinkView {
  link_id: string;
  ticket_id: string;
  entity_type: ExternalEntityLinkEntityType;
  entity_id: string;
  system: string;
  external_id: string;
  external_parent_id: string | null;
  realm: string | null;
  url: string | null;
  relationship: ExternalLinkRelationship;
  actor: ExternalSystemActor | null;
  external_status: string | null;
  external_updated_at: string | null;
  last_synced_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  display: ExternalLinkDisplay;
}

export interface ExternalSystemOption {
  key: string;
  label: string;
  icon: string;
  urlTemplate?: string;
  realmLabel?: string;
  originCategory: string;
  isCustom: boolean;
  url_template: string | null;
}

function tenantTable(conn: Knex | Knex.Transaction, tenant: string, table: string) {
  return tenantDb(conn, tenant).table(table);
}

/**
 * External links and custom systems are MSP-only (plan §5): client-portal
 * contacts also hold coarse `ticket:read`/`ticket:update`, so possession of the
 * permission is not enough. Reject any non-internal session before touching the
 * tenant-scoped tables.
 */
function assertInternalUser(user: { user_type?: string }): void {
  if (user?.user_type !== 'internal') {
    throw new Error('Permission denied: external link actions are internal-only');
  }
}

/**
 * Enforce the same per-record ticket authorization `getTicketById` applies.
 * Client-portal visibility and relationship/bundle narrowing are evaluated for
 * the owning ticket, not just the coarse `ticket:read|update` permission.
 */
async function authorizeTicketAccess(
  user: IUserWithRoles,
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
  action: 'read' | 'update',
): Promise<void> {
  try {
    // Bundle rules match actions exactly. Ticket read restrictions must also
    // protect link mutations, even when no update-specific rule is configured.
    await authorizeTicketRecordAccess({
      trx,
      tenant,
      user,
      ticketId,
      action: 'read',
    });
    if (action === 'update') {
      await authorizeTicketRecordAccess({ trx, tenant, user, ticketId, action });
    }
  } catch (error) {
    // Preserve the structured not-found result the action layer already exposes;
    // `Permission denied` errors are mapped to permissionError by the caller.
    if (error instanceof Error && error.message === 'Ticket not found') {
      throw new ExternalLinkValidationError('ticket_not_found', 'Ticket not found');
    }
    throw error;
  }
}

function toView(
  row: IExternalEntityLink,
  tenantSystems: readonly ITenantExternalSystem[],
): ITicketExternalLinkView {
  const definition = resolveExternalSystem(tenantSystems, row.system);
  return {
    link_id: row.link_id ?? '',
    ticket_id: row.ticket_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    system: row.system,
    external_id: row.external_id,
    external_parent_id: row.external_parent_id ?? null,
    realm: row.realm ?? null,
    url: row.url ?? null,
    relationship: row.relationship,
    actor: row.actor ?? null,
    external_status: row.external_status ?? null,
    external_updated_at: row.external_updated_at ?? null,
    last_synced_at: row.last_synced_at ?? null,
    metadata: row.metadata ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    display: {
      label: definition?.label ?? row.system,
      icon: definition?.icon ?? 'Link',
      href: renderExternalLinkUrl(definition, row),
      realmLabel: definition?.realmLabel ?? null,
    },
  };
}

export const getTicketExternalLinks = withAuth(
  async (user, { tenant }, ticketId: string): Promise<ITicketExternalLinkView[] | ExternalLinkActionError> => {
    try {
      assertInternalUser(user);
      if (!(await hasPermission(user, 'ticket', 'read'))) {
        throw new Error('Permission denied: Cannot read ticket links');
      }
      const { knex } = await createTenantKnex();
      const [rows, systems] = await withTransaction(knex, async (trx) => {
        await authorizeTicketAccess(user, trx, tenant, ticketId, 'read');
        return Promise.all([
          tenantTable(trx, tenant, 'external_entity_links')
            .where({ ticket_id: ticketId })
            .orderBy([
              { column: 'entity_type', order: 'asc' },
              { column: 'created_at', order: 'asc' },
            ]),
          loadTenantExternalSystems(trx, tenant),
        ]);
      });
      return (rows as IExternalEntityLink[]).map((row) => toView(row, systems));
    } catch (error) {
      const expected = externalLinkActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  },
);

export const addExternalLink = withAuth(
  async (user, { tenant }, input: AddExternalLinkInput): Promise<ITicketExternalLinkView | ExternalLinkActionError> => {
    try {
      assertInternalUser(user);
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot update ticket links');
      }
      const { knex } = await createTenantKnex();
      const result = await withTransaction(knex, async (trx) => {
        await authorizeTicketAccess(user, trx, tenant, input.ticket_id, 'update');
        const prepared = await prepareExternalLink(trx, tenant, input);
        const row = await insertExternalLink(trx, tenant, prepared, user.user_id);
        const systems = await loadTenantExternalSystems(trx, tenant);
        await writeTicketActivity(trx, {
          tenant,
          ticketId: row.ticket_id,
          eventType: TICKET_ACTIVITY_EVENT.EXTERNAL_LINK_ADDED,
          entityType: TICKET_ACTIVITY_ENTITY.SYSTEM,
          entityId: row.link_id,
          actor: {
            actorType: TICKET_ACTIVITY_ACTOR.USER,
            userId: user.user_id,
            displayName: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username,
          },
          source: TICKET_ACTIVITY_SOURCE.EXTERNAL_LINK,
          occurredAt: new Date().toISOString(),
          details: {
            system: row.system,
            system_label: resolveExternalSystem(systems, row.system)?.label ?? row.system,
            external_id: row.external_id,
            relationship: row.relationship,
            entity_type: row.entity_type,
          },
        });
        return { row, systems };
      });
      await publishExternalLinkEvent('TICKET_EXTERNAL_LINK_ADDED', tenant, result.row, user.user_id);
      return toView(result.row, result.systems);
    } catch (error) {
      const expected = externalLinkActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  },
);

export const updateExternalLink = withAuth(
  async (user, { tenant }, linkId: string, patch: UpdateExternalLinkPatch): Promise<ITicketExternalLinkView | ExternalLinkActionError> => {
    try {
      assertInternalUser(user);
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot update ticket links');
      }
      const { knex } = await createTenantKnex();
      const result = await withTransaction(knex, async (trx) => {
        const existing = await tenantTable(trx, tenant, 'external_entity_links')
          .where({ link_id: linkId })
          .first();
        if (!existing) {
          throw new ExternalLinkValidationError('link_not_found', 'External link not found');
        }
        await authorizeTicketAccess(user, trx, tenant, existing.ticket_id, 'update');

        const updates: Record<string, unknown> = { updated_at: trx.fn.now() };

        if (patch.relationship !== undefined && patch.relationship !== existing.relationship) {
          if (patch.relationship === 'origin') {
            const existingOrigin = await tenantTable(trx, tenant, 'external_entity_links')
              .where({
                entity_type: existing.entity_type,
                entity_id: existing.entity_id,
                relationship: 'origin',
              })
              .whereNot({ link_id: linkId })
              .select('link_id')
              .first();
            if (existingOrigin) {
              throw new ExternalLinkValidationError('origin_exists', 'This entity already has an origin link');
            }
          }
          updates.relationship = patch.relationship;
        }

        if (patch.url !== undefined) {
          if (patch.url === null || patch.url === '') {
            updates.url = null;
          } else {
            const safe = safeExternalUrl(patch.url);
            if (!safe) {
              throw new ExternalLinkValidationError('invalid_url', 'URL must be a valid http(s) URL');
            }
            updates.url = safe;
          }
        }
        if (patch.actor !== undefined) updates.actor = patch.actor;
        if (patch.external_status !== undefined) updates.external_status = patch.external_status;
        if (patch.external_updated_at !== undefined) updates.external_updated_at = patch.external_updated_at;
        if (patch.last_synced_at !== undefined) updates.last_synced_at = patch.last_synced_at;
        if (patch.metadata !== undefined) updates.metadata = patch.metadata;

        // An update must not leave the link without a clickable destination —
        // notably clearing the only explicit URL on a template-less system.
        const systems = await loadTenantExternalSystems(trx, tenant);
        assertLinkDestination(resolveExternalSystem(systems, existing.system), {
          external_id: existing.external_id,
          realm: existing.realm ?? null,
          url: updates.url !== undefined ? (updates.url as string | null) : (existing.url ?? null),
        });

        const [row] = await tenantTable(trx, tenant, 'external_entity_links')
          .where({ link_id: linkId })
          .update(updates)
          .returning('*');
        return { row: row as IExternalEntityLink, systems };
      });
      await publishExternalLinkEvent('TICKET_EXTERNAL_LINK_UPDATED', tenant, result.row, user.user_id);
      return toView(result.row, result.systems);
    } catch (error) {
      const expected = externalLinkActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  },
);

export const removeExternalLink = withAuth(
  async (user, { tenant }, linkId: string): Promise<{ link_id: string } | ExternalLinkActionError> => {
    try {
      assertInternalUser(user);
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot update ticket links');
      }
      const { knex } = await createTenantKnex();
      const removed = await withTransaction(knex, async (trx) => {
        const existing = await tenantTable(trx, tenant, 'external_entity_links')
          .where({ link_id: linkId })
          .first();
        if (!existing) {
          throw new ExternalLinkValidationError('link_not_found', 'External link not found');
        }
        await authorizeTicketAccess(user, trx, tenant, existing.ticket_id, 'update');
        await tenantTable(trx, tenant, 'external_entity_links').where({ link_id: linkId }).del();
        const systems = await loadTenantExternalSystems(trx, tenant);
        await writeTicketActivity(trx, {
          tenant,
          ticketId: existing.ticket_id,
          eventType: TICKET_ACTIVITY_EVENT.EXTERNAL_LINK_REMOVED,
          entityType: TICKET_ACTIVITY_ENTITY.SYSTEM,
          entityId: linkId,
          actor: {
            actorType: TICKET_ACTIVITY_ACTOR.USER,
            userId: user.user_id,
            displayName: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username,
          },
          source: TICKET_ACTIVITY_SOURCE.EXTERNAL_LINK,
          occurredAt: new Date().toISOString(),
          details: {
            system: existing.system,
            system_label: resolveExternalSystem(systems, existing.system)?.label ?? existing.system,
            external_id: existing.external_id,
            relationship: existing.relationship,
            entity_type: existing.entity_type,
          },
        });
        return existing as IExternalEntityLink;
      });
      await publishExternalLinkEvent('TICKET_EXTERNAL_LINK_REMOVED', tenant, removed, user.user_id);
      return { link_id: linkId };
    } catch (error) {
      const expected = externalLinkActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  },
);

export const findTicketByExternalLink = withAuth(
  async (
    user,
    { tenant },
    input: { system: string; external_id: string; external_parent_id?: string | null },
  ): Promise<{ ticket_id: string; link: ITicketExternalLinkView } | null | ExternalLinkActionError> => {
    try {
      assertInternalUser(user);
      if (!(await hasPermission(user, 'ticket', 'read'))) {
        throw new Error('Permission denied: Cannot read ticket links');
      }
      const externalId = input.external_id?.trim();
      if (!input.system || !externalId) {
        throw new ExternalLinkValidationError('external_id_required', 'External ID is required');
      }
      const { knex } = await createTenantKnex();
      return await withTransaction(knex, async (trx) => {
        const query = tenantTable(trx, tenant, 'external_entity_links')
          .where({ system: input.system, external_id: externalId });
        if (input.external_parent_id != null) {
          query.where({ external_parent_id: input.external_parent_id });
        }
        query.orderBy([{ column: 'entity_type', order: 'asc' }, { column: 'created_at', order: 'asc' }]);
        const rows = (await query) as IExternalEntityLink[];
        if (rows.length === 0) {
          return null;
        }
        // Resolve and authorize the owning ticket before leaking link data.
        await authorizeTicketAccess(user, trx, tenant, rows[0].ticket_id, 'read');
        const systems = await loadTenantExternalSystems(trx, tenant);
        const row = rows[0];
        return { ticket_id: row.ticket_id, link: toView(row, systems) };
      });
    } catch (error) {
      const expected = externalLinkActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  },
);

export const listExternalSystems = withAuth(
  async (user, { tenant }): Promise<ExternalSystemOption[] | ExternalLinkActionError> => {
    try {
      assertInternalUser(user);
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot read external systems');
      }
      const { knex } = await createTenantKnex();
      const rows = await loadTenantExternalSystems(knex, tenant);
      const definitions = buildSystemDefinitions(rows);
      const customKeys = new Set(rows.map((row) => row.key));
      return definitions.map((definition) => ({
        key: definition.key,
        label: definition.label,
        icon: definition.icon,
        urlTemplate: definition.urlTemplate,
        realmLabel: definition.realmLabel,
        originCategory: definition.originCategory,
        isCustom: customKeys.has(definition.key),
        url_template: rows.find((row) => row.key === definition.key)?.url_template ?? null,
      }));
    } catch (error) {
      const expected = externalLinkActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  },
);

export const upsertTenantExternalSystem = withAuth(
  async (
    user,
    { tenant },
    input: { key: string; label: string; url_template?: string | null },
  ): Promise<{ key: string; label: string; url_template: string | null } | ExternalLinkActionError> => {
    try {
      assertInternalUser(user);
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot manage external systems');
      }
      const key = input.key?.trim() ?? '';
      if (!CUSTOM_EXTERNAL_SYSTEM_KEY_PATTERN.test(key)) {
        throw new ExternalLinkValidationError('invalid_system_key', 'Custom system keys must match custom:<slug>');
      }
      const label = input.label?.trim();
      if (!label) {
        throw new ExternalLinkValidationError('system_label_required', 'System label is required');
      }
      const urlTemplate = input.url_template?.trim() || null;
      if (urlTemplate && !/^https?:\/\//i.test(urlTemplate)) {
        throw new ExternalLinkValidationError('invalid_url', 'URL template must start with http:// or https://');
      }

      const { knex } = await createTenantKnex();
      const [row] = await tenantTable(knex, tenant, 'tenant_external_systems')
        .insert({ tenant, key, label, url_template: urlTemplate })
        .onConflict(['tenant', 'key'])
        .merge({ label, url_template: urlTemplate, updated_at: knex.fn.now() })
        .returning('*');
      return { key: row.key, label: row.label, url_template: row.url_template ?? null };
    } catch (error) {
      const expected = externalLinkActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  },
);

export const deleteTenantExternalSystem = withAuth(
  async (user, { tenant }, key: string): Promise<{ key: string } | ExternalLinkActionError> => {
    try {
      assertInternalUser(user);
      if (!(await hasPermission(user, 'ticket', 'update'))) {
        throw new Error('Permission denied: Cannot manage external systems');
      }
      const { knex } = await createTenantKnex();
      const inUse = await tenantTable(knex, tenant, 'external_entity_links')
        .where({ system: key })
        .count<{ count: string }>('link_id as count')
        .first();
      const count = Number(inUse?.count ?? 0);
      if (count > 0) {
        return externalLinkActionError('system_in_use', {
          messageKey: 'features/tickets:externalLinks.errors.systemInUseCount',
          messageParams: { count },
        });
      }
      const deleted = await tenantTable(knex, tenant, 'tenant_external_systems').where({ key }).del();
      if (!deleted) {
        throw new ExternalLinkValidationError('system_not_found', 'Unknown external system');
      }
      return { key };
    } catch (error) {
      const expected = externalLinkActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
    }
  },
);
