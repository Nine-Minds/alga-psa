'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { revalidatePath } from 'next/cache';
import type { IBoard, IUserWithRoles } from '@alga-psa/types';
import { z } from 'zod';
import type { Knex } from 'knex';

const visibilityGroupSchema = z.object({
  name: z.string().trim().min(1, 'Group name is required'),
  description: z.string().trim().nullable().optional(),
  boardIds: z.array(z.string().uuid()).default([]),
  clientId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional()
});

const visibilityAssignmentSchema = z.object({
  contactId: z.string().uuid(),
  groupId: z.string().uuid().nullable()
});

const visibilityGroupIdSchema = z.object({
  groupId: z.string().uuid()
});

type GroupManagementScope = {
  clientId: string;
};

type VisibilityGroup = {
  group_id: string;
  client_id: string;
  name: string;
  description: string | null;
  board_ids: string[];
  board_count: number;
  assigned_contact_count: number;
};

type VisibilityGroupDetail = VisibilityGroup & {
  boards: IBoard[];
};

type VisibilityContact = {
  contact_name_id: string;
  full_name: string;
  email: string | null;
  is_client_admin: boolean | null;
  portal_visibility_group_id: string | null;
};

export type DeleteClientPortalVisibilityGroupResult =
  | { ok: true }
  | {
      ok: false;
      code: 'ASSIGNED_TO_CONTACTS' | 'NOT_FOUND';
    };

function uniqueItems<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function toInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function ensureBoardsAreActiveInTenant(
  trx: Knex.Transaction,
  tenant: string,
  boardIds: string[]
) {
  if (!boardIds.length) {
    return;
  }

  const rows = await trx('boards')
    .where({ tenant })
    .andWhere('is_inactive', false)
    .whereIn('board_id', boardIds)
    .select('board_id');

  const existing = rows.map((row) => row.board_id);
  const missing = boardIds.filter((boardId) => !existing.includes(boardId));

  if (missing.length > 0) {
    throw new Error('One or more boards are invalid for this tenant');
  }
}

async function ensureBoardsAreActiveOrAlreadyAssignedToGroup(
  trx: Knex.Transaction,
  tenant: string,
  groupId: string,
  boardIds: string[]
) {
  if (!boardIds.length) {
    return;
  }

  const activeRows = await trx('boards')
    .where({ tenant })
    .andWhere('is_inactive', false)
    .whereIn('board_id', boardIds)
    .select('board_id');

  const existingMembershipRows = await trx('client_portal_visibility_group_boards')
    .where({ tenant, group_id: groupId })
    .whereIn('board_id', boardIds)
    .select('board_id');

  const allowedBoardIds = new Set<string>([
    ...activeRows.map((row) => row.board_id),
    ...existingMembershipRows.map((row) => row.board_id),
  ]);
  const missing = boardIds.filter((boardId) => !allowedBoardIds.has(boardId));

  if (missing.length > 0) {
    throw new Error('One or more boards are invalid for this tenant');
  }
}

async function resolveManagementScope(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  targetClientId?: string,
  targetContactId?: string
): Promise<GroupManagementScope> {
  if (user.user_type === 'client' && user.contact_id) {
    const actorContact = await trx('contacts')
      .where({
        tenant,
        contact_name_id: user.contact_id
      })
      .select('client_id', 'is_client_admin')
      .first();

    if (!actorContact?.is_client_admin || !actorContact.client_id) {
      throw new Error('Permission denied: Client portal admin access is required');
    }

    const managedClientId = actorContact.client_id;

    if (targetContactId) {
      const targetContact = await trx('contacts')
        .where({
          tenant,
          contact_name_id: targetContactId
        })
        .select('client_id')
        .first();

      if (!targetContact?.client_id) {
        throw new Error('Contact not found');
      }

      if (targetContact.client_id !== managedClientId) {
        throw new Error('Cannot manage visibility groups for another client');
      }
    }

    if (targetClientId && targetClientId !== managedClientId) {
      throw new Error('Cannot manage visibility groups for another client');
    }

    return { clientId: managedClientId };
  }

  const canManage = await hasPermission(user, 'contact', 'update', trx);
  if (!canManage) {
    throw new Error('Permission denied: Cannot manage contacts');
  }

  let scopeClientId: string | null = targetClientId || null;

  if (targetContactId) {
    const targetContact = await trx('contacts')
      .where({
        tenant,
        contact_name_id: targetContactId
      })
      .select('client_id')
      .first();

    if (!targetContact?.client_id) {
      throw new Error('Contact not found');
    }

    if (!scopeClientId) {
      scopeClientId = targetContact.client_id;
    } else if (scopeClientId !== targetContact.client_id) {
      throw new Error('Cannot manage visibility groups for another client');
    }
  }

  if (!scopeClientId) {
    throw new Error('A target client or contact is required');
  }

  return { clientId: scopeClientId };
}

export const getClientPortalVisibilityGroups = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: { tenant: string },
  targetContactId?: string,
  targetClientId?: string
): Promise<VisibilityGroup[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const { clientId } = await resolveManagementScope(trx, tenant, currentUser, targetClientId, targetContactId);

    const groups = await trx('client_portal_visibility_groups')
      .where({
        tenant,
        client_id: clientId
      })
      .select('group_id', 'client_id', 'name', 'description')
      .orderBy('name');

    const boardCounts = groups.length
      ? await trx('client_portal_visibility_group_boards')
        .where({ tenant })
        .whereIn('group_id', groups.map((group) => group.group_id))
        .select('group_id')
        .count('board_id as board_count')
        .groupBy('group_id')
      : [];

    const assignmentCounts = groups.length
      ? await trx('contacts')
        .where({ tenant })
        .whereIn('portal_visibility_group_id', groups.map((group) => group.group_id))
        .select('portal_visibility_group_id')
        .count('contact_name_id as assigned_contact_count')
        .groupBy('portal_visibility_group_id')
      : [];

    const boardCountMap = new Map<string, number>(
      boardCounts.map((row: { group_id: string; board_count: string | number }) => [
        row.group_id,
        toInt(row.board_count)
      ])
    );
    const assignmentCountMap = new Map<string, number>(
      assignmentCounts.map((row: { portal_visibility_group_id: string | null; assigned_contact_count: string | number }) => [
        String(row.portal_visibility_group_id),
        toInt(row.assigned_contact_count)
      ])
    );

    return groups.map((group) => ({
      ...group,
      board_ids: [],
      board_count: boardCountMap.get(group.group_id) || 0,
      assigned_contact_count: assignmentCountMap.get(group.group_id) || 0
    }));
  });
});

export const getClientPortalVisibilityGroup = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: { tenant: string },
  groupId: string,
  targetContactId?: string,
  targetClientId?: string
): Promise<VisibilityGroupDetail | null> => {
  visibilityGroupIdSchema.parse({ groupId });
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const { clientId } = await resolveManagementScope(trx, tenant, currentUser, targetClientId, targetContactId);

    const group = await trx('client_portal_visibility_groups')
      .where({
        tenant,
        client_id: clientId,
        group_id: groupId
      })
      .first();

    if (!group) {
      return null;
    }

    const boardRows = await trx('client_portal_visibility_group_boards as cvgb')
      .join('boards', function() {
        this.on('boards.board_id', '=', 'cvgb.board_id')
          .andOn('boards.tenant', '=', 'cvgb.tenant');
      })
      .where({
        'cvgb.tenant': tenant,
        'cvgb.group_id': groupId
      })
      .select('boards.board_id', 'boards.board_name', 'boards.is_default');

    const boardCountRows = await trx('client_portal_visibility_group_boards')
      .where({ tenant, group_id: groupId })
      .count('* as board_count')
      .first();

    const assignmentCountRows = await trx('contacts')
      .where({
        tenant,
        portal_visibility_group_id: groupId
      })
      .count('* as assigned_contact_count')
      .first();

    return {
      ...group,
      board_ids: boardRows.map((board: { board_id: string }) => board.board_id),
      board_count: Number(boardCountRows?.board_count || 0),
      assigned_contact_count: Number(assignmentCountRows?.assigned_contact_count || 0),
      boards: boardRows
    };
  });
});

export const getClientPortalVisibilityGroupBoards = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: { tenant: string },
  targetContactId?: string,
  targetClientId?: string
): Promise<IBoard[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    await resolveManagementScope(trx, tenant, currentUser, targetClientId, targetContactId);

    return trx('boards')
      .where({ tenant })
      .andWhere('is_inactive', false)
      .select('board_id', 'board_name');
  });
});

export const getClientPortalVisibilityContacts = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: { tenant: string },
  targetClientId?: string
): Promise<VisibilityContact[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const { clientId } = await resolveManagementScope(trx, tenant, currentUser, targetClientId);

    return trx('contacts')
      .where({
        tenant,
        client_id: clientId
      })
      .select('contact_name_id', 'full_name', 'email', 'is_client_admin', 'portal_visibility_group_id')
      .orderBy('full_name');
  });
});

export const createClientPortalVisibilityGroup = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: { tenant: string },
  input: z.infer<typeof visibilityGroupSchema>
): Promise<{ group_id: string }> => {
  const payload = visibilityGroupSchema.parse(input);
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const { clientId } = await resolveManagementScope(
      trx,
      tenant,
      currentUser,
      payload.clientId,
      payload.contactId
    );

    const boardIds = uniqueItems(payload.boardIds);
    await ensureBoardsAreActiveInTenant(trx, tenant, boardIds);

    const [group] = await trx('client_portal_visibility_groups')
      .insert({
        tenant,
        client_id: clientId,
        name: payload.name,
        description: payload.description
      })
      .returning('group_id');

    if (!group?.group_id) {
      throw new Error('Failed to create visibility group');
    }

    if (boardIds.length > 0) {
      await trx('client_portal_visibility_group_boards')
        .insert(boardIds.map((boardId) => ({
          tenant,
          group_id: group.group_id,
          board_id: boardId
        })));
    }

    revalidatePath('/client-portal/client-settings?tab=visibility-groups');

    return { group_id: group.group_id };
  });
});

export const updateClientPortalVisibilityGroup = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: { tenant: string },
  groupId: string,
  input: Omit<z.infer<typeof visibilityGroupSchema>, 'clientId' | 'contactId'>
): Promise<void> => {
  visibilityGroupIdSchema.parse({ groupId });
  const payload = visibilityGroupSchema
    .omit({ clientId: true, contactId: true })
    .parse(input);

  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const { clientId } = await resolveManagementScope(trx, tenant, currentUser);
    const boardIds = uniqueItems(payload.boardIds);
    await ensureBoardsAreActiveOrAlreadyAssignedToGroup(trx, tenant, groupId, boardIds);

    const existing = await trx('client_portal_visibility_groups')
      .where({ tenant, group_id: groupId, client_id: clientId })
      .first('group_id');

    if (!existing) {
      throw new Error('Visibility group not found');
    }

    await trx('client_portal_visibility_groups')
      .where({ tenant, group_id: groupId })
      .update({
        name: payload.name,
        description: payload.description,
        updated_at: new Date().toISOString()
      });

    await trx('client_portal_visibility_group_boards')
      .where({ tenant, group_id: groupId })
      .delete();

    if (boardIds.length > 0) {
      await trx('client_portal_visibility_group_boards')
        .insert(boardIds.map((boardId) => ({
          tenant,
          group_id: groupId,
          board_id: boardId
        })));
    }

    revalidatePath('/client-portal/client-settings?tab=visibility-groups');
  });
});

export const deleteClientPortalVisibilityGroup = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: { tenant: string },
  groupId: string
): Promise<DeleteClientPortalVisibilityGroupResult> => {
  visibilityGroupIdSchema.parse({ groupId });
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const { clientId } = await resolveManagementScope(trx, tenant, currentUser);

    const existing = await trx('client_portal_visibility_groups')
      .where({ tenant, client_id: clientId, group_id: groupId })
      .first();

    if (!existing) {
      return { ok: false, code: 'NOT_FOUND' };
    }

    const assignedCount = await trx('contacts')
      .where({
        tenant,
        client_id: clientId,
        portal_visibility_group_id: groupId
      })
      .count('contact_name_id as count')
      .first();

    if (toInt(assignedCount?.count) > 0) {
      return { ok: false, code: 'ASSIGNED_TO_CONTACTS' };
    }

    await trx('client_portal_visibility_group_boards')
      .where({ tenant, group_id: groupId })
      .delete();

    await trx('client_portal_visibility_groups')
      .where({ tenant, group_id: groupId })
      .delete();

    revalidatePath('/client-portal/client-settings?tab=visibility-groups');
    return { ok: true };
  });
});

export const assignClientPortalVisibilityGroupToContact = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: { tenant: string },
  input: z.infer<typeof visibilityAssignmentSchema>
): Promise<void> => {
  const { contactId, groupId } = visibilityAssignmentSchema.parse(input);
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const contact = await trx('contacts')
      .where({
        tenant,
        contact_name_id: contactId
      })
      .first('client_id');

    if (!contact?.client_id) {
      throw new Error('Contact not found');
    }

    const { clientId } = await resolveManagementScope(trx, tenant, currentUser, contact.client_id, contactId);

    if (groupId) {
      const group = await trx('client_portal_visibility_groups')
        .where({
          tenant,
          group_id: groupId,
          client_id: clientId
        })
        .first('group_id');

      if (!group) {
        throw new Error('Assigned visibility group is invalid for this contact');
      }
    }

    await trx('contacts')
      .where({ tenant, contact_name_id: contactId })
      .update({
        portal_visibility_group_id: groupId,
        updated_at: new Date().toISOString()
      });

    revalidatePath('/client-portal/client-settings?tab=visibility-groups');
  });
});
