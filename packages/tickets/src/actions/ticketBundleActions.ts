'use server';

import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { z } from 'zod';
import type { IUser } from '@alga-psa/types';

function nowIso() {
  return new Date().toISOString();
}

async function ensureTicketsAreNotBundleMasters(
  trx: any,
  tenant: string,
  ticketIds: string[]
) {
  if (ticketIds.length === 0) return;
  const rows = await trx('tickets')
    .select('master_ticket_id')
    .count('* as count')
    .where({ tenant })
    .whereIn('master_ticket_id', ticketIds)
    .groupBy('master_ticket_id');

  if (rows.length > 0) {
    throw new Error('One or more selected tickets are bundle masters and cannot be added as children.');
  }
}

const bundleTicketsSchema = z.object({
  masterTicketId: z.string().uuid(),
  childTicketIds: z.array(z.string().uuid()).min(1),
  mode: z.enum(['link_only', 'sync_updates']).default('sync_updates'),
});

const findTicketByNumberSchema = z.object({
  ticketNumber: z.string().min(1),
});

export async function findTicketByNumberAction(input: z.input<typeof findTicketByNumberSchema>, user: IUser) {
  const data = findTicketByNumberSchema.parse(input);
  const { knex: db, tenant } = await createTenantKnex(user.tenant);
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }
    const ticket = await trx('tickets')
      .select('ticket_id', 'ticket_number', 'title', 'client_id', 'master_ticket_id')
      .where({ tenant })
      .andWhere('ticket_number', 'ilike', data.ticketNumber)
      .first();
    return ticket || null;
  });
}

export async function bundleTicketsAction(input: z.input<typeof bundleTicketsSchema>, user: IUser) {
  const data = bundleTicketsSchema.parse(input);
  const uniqueChildIds = Array.from(new Set(data.childTicketIds)).filter((id) => id !== data.masterTicketId);
  if (uniqueChildIds.length === 0) {
    throw new Error('Select at least one child ticket different from the master.');
  }

  const { knex: db, tenant } = await createTenantKnex(user.tenant);
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot bundle tickets');
    }

    // Fetch master + children and validate tenant isolation
    const tickets = await trx('tickets')
      .select('ticket_id', 'ticket_number', 'master_ticket_id')
      .where({ tenant })
      .whereIn('ticket_id', [data.masterTicketId, ...uniqueChildIds]);

    const byId = new Map(tickets.map((t: any) => [t.ticket_id, t]));
    if (!byId.has(data.masterTicketId)) {
      throw new Error('Master ticket not found');
    }
    for (const childId of uniqueChildIds) {
      if (!byId.has(childId)) {
        throw new Error(`Child ticket not found: ${childId}`);
      }
    }

    const master = byId.get(data.masterTicketId);
    if (master.master_ticket_id) {
      throw new Error('Cannot select a child ticket as the master.');
    }

    // Prevent nesting bundles: children cannot themselves be masters
    await ensureTicketsAreNotBundleMasters(trx, tenant, uniqueChildIds);

    // Ensure children are not already bundled
    for (const childId of uniqueChildIds) {
      const child = byId.get(childId);
      if (child.master_ticket_id) {
        throw new Error(`Ticket is already bundled: ${child.ticket_number || childId}`);
      }
      if (childId === data.masterTicketId) {
        throw new Error('Master ticket cannot also be a child ticket.');
      }
    }

    // Attach children to master (do not change child status/assignment/etc)
    await trx('tickets')
      .where({ tenant })
      .whereIn('ticket_id', uniqueChildIds)
      .update({
        master_ticket_id: data.masterTicketId,
        updated_by: user.user_id,
        updated_at: nowIso(),
      });

    // Upsert bundle settings for the master
    await trx('ticket_bundle_settings')
      .insert({
        tenant,
        master_ticket_id: data.masterTicketId,
        mode: data.mode,
        reopen_on_child_reply: false,
      })
      .onConflict(['tenant', 'master_ticket_id'])
      .merge({
        mode: data.mode,
      });

    return { masterTicketId: data.masterTicketId, childTicketIds: uniqueChildIds, mode: data.mode };
  });
}

const addChildrenSchema = z.object({
  masterTicketId: z.string().uuid(),
  childTicketIds: z.array(z.string().uuid()).min(1),
});

export async function addChildrenToBundleAction(input: z.input<typeof addChildrenSchema>, user: IUser) {
  const data = addChildrenSchema.parse(input);
  const childIds = Array.from(new Set(data.childTicketIds)).filter((id) => id !== data.masterTicketId);
  if (childIds.length === 0) {
    throw new Error('No child tickets provided');
  }

  const { knex: db, tenant } = await createTenantKnex(user.tenant);
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    const master = await trx('tickets')
      .select('ticket_id', 'master_ticket_id')
      .where({ tenant, ticket_id: data.masterTicketId })
      .first();
    if (!master) throw new Error('Master ticket not found');
    if (master.master_ticket_id) throw new Error('Cannot add children to a bundled child ticket');

    const children = await trx('tickets')
      .select('ticket_id', 'ticket_number', 'master_ticket_id')
      .where({ tenant })
      .whereIn('ticket_id', childIds);
    const byId = new Map(children.map((t: any) => [t.ticket_id, t]));
    for (const childId of childIds) {
      const child = byId.get(childId);
      if (!child) throw new Error(`Child ticket not found: ${childId}`);
      if (child.master_ticket_id) throw new Error(`Ticket is already bundled: ${child.ticket_number || childId}`);
    }

    // Prevent nesting bundles: children cannot themselves be masters
    await ensureTicketsAreNotBundleMasters(trx, tenant, childIds);

    await trx('tickets')
      .where({ tenant })
      .whereIn('ticket_id', childIds)
      .update({
        master_ticket_id: data.masterTicketId,
        updated_by: user.user_id,
        updated_at: nowIso(),
      });

    return { masterTicketId: data.masterTicketId, childTicketIds: childIds };
  });
}

const promoteMasterSchema = z.object({
  oldMasterTicketId: z.string().uuid(),
  newMasterTicketId: z.string().uuid(),
});

export async function promoteBundleMasterAction(input: z.input<typeof promoteMasterSchema>, user: IUser) {
  const data = promoteMasterSchema.parse(input);
  if (data.oldMasterTicketId === data.newMasterTicketId) {
    throw new Error('New master ticket must be different from the current master.');
  }
  const { knex: db, tenant } = await createTenantKnex(user.tenant);
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    const oldMaster = await trx('tickets')
      .select('ticket_id', 'master_ticket_id')
      .where({ tenant, ticket_id: data.oldMasterTicketId })
      .first();
    if (!oldMaster) throw new Error('Old master ticket not found');
    if (oldMaster.master_ticket_id) throw new Error('Old master ticket is not a master');

    const newMaster = await trx('tickets')
      .select('ticket_id', 'master_ticket_id')
      .where({ tenant, ticket_id: data.newMasterTicketId })
      .first();
    if (!newMaster) throw new Error('New master ticket not found');
    if (newMaster.master_ticket_id !== data.oldMasterTicketId) {
      throw new Error('New master ticket must be a child of the current master');
    }

    const now = nowIso();

    // Prevent nesting bundles: the promoted ticket cannot itself have children
    await ensureTicketsAreNotBundleMasters(trx, tenant, [data.newMasterTicketId]);

    // Move bundle settings to new master
    const settings = await trx('ticket_bundle_settings')
      .where({ tenant, master_ticket_id: data.oldMasterTicketId })
      .first();
    if (settings) {
      await trx('ticket_bundle_settings')
        .where({ tenant, master_ticket_id: data.oldMasterTicketId })
        .delete();
      await trx('ticket_bundle_settings')
        .insert({
          ...settings,
          master_ticket_id: data.newMasterTicketId,
        })
        .onConflict(['tenant', 'master_ticket_id'])
        .merge({
          mode: settings.mode,
          reopen_on_child_reply: settings.reopen_on_child_reply,
        });
    }

    // Re-point children to new master (including old master)
    await trx('tickets')
      .where({ tenant, master_ticket_id: data.oldMasterTicketId })
      .andWhereNot({ ticket_id: data.newMasterTicketId })
      .update({
        master_ticket_id: data.newMasterTicketId,
        updated_by: user.user_id,
        updated_at: now,
      });

    // New master becomes root
    await trx('tickets')
      .where({ tenant, ticket_id: data.newMasterTicketId })
      .update({
        master_ticket_id: null,
        updated_by: user.user_id,
        updated_at: now,
      });

    // Old master becomes child
    await trx('tickets')
      .where({ tenant, ticket_id: data.oldMasterTicketId })
      .update({
        master_ticket_id: data.newMasterTicketId,
        updated_by: user.user_id,
        updated_at: now,
      });

    return { oldMasterTicketId: data.oldMasterTicketId, newMasterTicketId: data.newMasterTicketId };
  });
}

const updateBundleSettingsSchema = z.object({
  masterTicketId: z.string().uuid(),
  mode: z.enum(['link_only', 'sync_updates']).optional(),
  reopenOnChildReply: z.boolean().optional(),
});

export async function updateBundleSettingsAction(input: z.input<typeof updateBundleSettingsSchema>, user: IUser) {
  const data = updateBundleSettingsSchema.parse(input);
  const { knex: db, tenant } = await createTenantKnex(user.tenant);
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    const existing = await trx('ticket_bundle_settings')
      .where({ tenant, master_ticket_id: data.masterTicketId })
      .first();
    if (!existing) throw new Error('Bundle settings not found');

    const update: any = {};
    if (data.mode) update.mode = data.mode;
    if (data.reopenOnChildReply !== undefined) update.reopen_on_child_reply = data.reopenOnChildReply;

    if (Object.keys(update).length === 0) {
      return {
        master_ticket_id: existing.master_ticket_id,
        mode: existing.mode,
        reopen_on_child_reply: existing.reopen_on_child_reply,
      };
    }

    const [updated] = await trx('ticket_bundle_settings')
      .where({ tenant, master_ticket_id: data.masterTicketId })
      .update(update)
      .returning(['master_ticket_id', 'mode', 'reopen_on_child_reply']);

    return updated;
  });
}

const removeChildSchema = z.object({
  childTicketId: z.string().uuid(),
});

export async function removeChildFromBundleAction(input: z.input<typeof removeChildSchema>, user: IUser) {
  const data = removeChildSchema.parse(input);
  const { knex: db, tenant } = await createTenantKnex(user.tenant);
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    const child = await trx('tickets')
      .select('ticket_id', 'master_ticket_id')
      .where({ tenant, ticket_id: data.childTicketId })
      .first();

    if (!child) throw new Error('Ticket not found');
    if (!child.master_ticket_id) throw new Error('Ticket is not bundled');

    const masterTicketId = child.master_ticket_id;

    await trx('tickets')
      .where({ tenant, ticket_id: data.childTicketId })
      .update({
        master_ticket_id: null,
        updated_by: user.user_id,
        updated_at: nowIso(),
      });

    // If the master now has no children, remove bundle settings
    const [{ count }] = await trx('tickets')
      .where({ tenant, master_ticket_id: masterTicketId })
      .count('ticket_id as count');
    const remaining = Number.parseInt(String(count), 10) || 0;
    if (remaining === 0) {
      await trx('ticket_bundle_settings')
        .where({ tenant, master_ticket_id: masterTicketId })
        .delete();
    }

    return { masterTicketId, childTicketId: data.childTicketId, remainingChildren: remaining };
  });
}

const unbundleSchema = z.object({
  masterTicketId: z.string().uuid(),
});

export async function unbundleMasterTicketAction(input: z.input<typeof unbundleSchema>, user: IUser) {
  const data = unbundleSchema.parse(input);
  const { knex: db, tenant } = await createTenantKnex(user.tenant);
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot modify ticket bundles');
    }

    // Ensure master exists and is not itself a child
    const master = await trx('tickets')
      .select('ticket_id', 'master_ticket_id')
      .where({ tenant, ticket_id: data.masterTicketId })
      .first();
    if (!master) throw new Error('Master ticket not found');
    if (master.master_ticket_id) throw new Error('Cannot unbundle from a child ticket id');

    await trx('tickets')
      .where({ tenant, master_ticket_id: data.masterTicketId })
      .update({
        master_ticket_id: null,
        updated_by: user.user_id,
        updated_at: nowIso(),
      });

    await trx('ticket_bundle_settings')
      .where({ tenant, master_ticket_id: data.masterTicketId })
      .delete();

    return { masterTicketId: data.masterTicketId };
  });
}
