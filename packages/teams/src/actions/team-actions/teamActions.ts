'use server'

import Team from '../../models/team';
import type { DeletionValidationResult, IRole, ITeam, ITeamMember, IUser, IUserWithRoles } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { deleteEntityWithValidation } from '@alga-psa/core';

async function getUsersWithRoles(
  trx: Knex | Knex.Transaction,
  tenant: string,
  members: Array<{ user_id: string; role: 'member' | 'lead' }>,
): Promise<ITeamMember[]> {
  if (members.length === 0) {
    return [];
  }

  const userIds = members.map((member) => member.user_id);
  const users = await trx<IUser>('users')
    .select('*')
    .whereIn('user_id', userIds)
    .where('tenant', tenant);

  const roles = await trx<IRole>('roles')
    .join('user_roles', function () {
      this.on('roles.role_id', '=', 'user_roles.role_id')
        .andOn('roles.tenant', '=', 'user_roles.tenant');
    })
    .whereIn('user_roles.user_id', userIds)
    .where('user_roles.tenant', tenant)
    .where('roles.tenant', tenant)
    .select('roles.*', 'user_roles.user_id as user_id');

  const rolesByUser = new Map<string, IRole[]>();
  for (const row of roles as any[]) {
    const userId = row.user_id as string;
    const role: IRole = { ...(row as any) };
    delete (role as any).user_id;
    const list = rolesByUser.get(userId) ?? [];
    list.push(role);
    rolesByUser.set(userId, list);
  }

  const roleByUser = new Map(members.map((member) => [member.user_id, member.role]));

  return users.map((user) => ({
    ...(user as any),
    roles: rolesByUser.get(user.user_id) ?? [],
    role: roleByUser.get(user.user_id) ?? 'member',
  }));
}

export const createTeam = withAuth(async (user, { tenant }, teamData: Omit<ITeam, 'members'> & { members?: IUserWithRoles[] }): Promise<ITeam> => {
  const { knex: db } = await createTenantKnex();
  const canCreate = await hasPermission(user, 'user_settings', 'create', db);
  if (!canCreate) {
    throw new Error('Permission denied: cannot create team.');
  }

  try {
    // Extract members from teamData
    const { members, ...teamDataWithoutMembers } = teamData;

    // If no manager_id is provided and there are members, use the first member as manager
    if (!teamDataWithoutMembers.manager_id && members && members.length > 0) {
      teamDataWithoutMembers.manager_id = members[0].user_id;
    } else if (!teamDataWithoutMembers.manager_id) {
      throw new Error('A team must have a manager. Please specify a manager_id or provide at least one team member.');
    }

    const createdTeam = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Create the team first
      const team = await Team.create(trx, tenant, teamDataWithoutMembers);

      // Collect all member IDs including the manager
      const allMemberRoles = new Map<string, 'member' | 'lead'>();

      // Add provided members
      if (members && members.length > 0) {
        members.forEach(member => allMemberRoles.set(member.user_id, 'member'));
      }

      // Add manager as a member if specified
      if (teamDataWithoutMembers.manager_id) {
        allMemberRoles.set(teamDataWithoutMembers.manager_id, 'lead');
      }

      // Add all members to the team
      if (allMemberRoles.size > 0) {
        await Promise.all(
          Array.from(allMemberRoles.entries()).map(([userId, role]): Promise<void> =>
            Team.addMember(trx, tenant, team.team_id, userId, role)
          )
        );
      }

      return team;
    });

    // Return the complete team with members
    return await getTeamByIdInternal(db, tenant, createdTeam.team_id);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to create team');
  }
});

// Internal helper function for getting team by ID (used by other actions within the same withAuth context)
async function getTeamByIdInternal(knex: Knex, tenant: string, teamId: string): Promise<ITeam> {
  const team = await Team.get(knex, tenant, teamId);
  if (!team) {
    throw new Error('Team not found');
  }
  const memberEntries = await Team.getMembers(knex, tenant, teamId);
  const members = await getUsersWithRoles(knex, tenant, memberEntries);

  return { ...team, members };
}

export const updateTeam = withAuth(async (user, { tenant }, teamId: string, teamData: Partial<ITeam>): Promise<ITeam> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    throw new Error('Permission denied: cannot update team.');
  }

  try {
    await Team.update(knex, tenant, teamId, teamData);
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to update team');
  }
});

export const deleteTeam = withAuth(async (
  user,
  { tenant },
  teamId: string
): Promise<DeletionValidationResult & { success: boolean; deleted?: boolean }> => {
  const { knex } = await createTenantKnex();
  const canDelete = await hasPermission(user, 'user_settings', 'delete', knex);
  if (!canDelete) {
    return {
      success: false,
      canDelete: false,
      code: 'PERMISSION_DENIED',
      message: 'Permission denied: cannot delete team.',
      dependencies: [],
      alternatives: []
    };
  }

  try {

    const result = await deleteEntityWithValidation('team', teamId, knex, tenant, async (trx, tenantId) => {
      await Team.delete(trx, tenantId, teamId);
    });

    return {
      ...result,
      success: result.deleted === true,
      deleted: result.deleted
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'Failed to delete team',
      dependencies: [],
      alternatives: []
    };
  }
});

export const addUserToTeam = withAuth(async (user, { tenant }, teamId: string, userId: string): Promise<ITeam> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    throw new Error('Permission denied: cannot modify team members.');
  }

  try {
    await Team.addMember(knex, tenant, teamId, userId);
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to add user to team');
  }
});

export const removeUserFromTeam = withAuth(async (user, { tenant }, teamId: string, userId: string): Promise<ITeam> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    throw new Error('Permission denied: cannot modify team members.');
  }

  try {
    await Team.removeMember(knex, tenant, teamId, userId);
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to remove user from team');
  }
});

export const getTeamById = withAuth(async (user, { tenant }, teamId: string): Promise<ITeam> => {
  const { knex } = await createTenantKnex();
  const canRead = await hasPermission(user, 'user_settings', 'read', knex);
  if (!canRead) {
    throw new Error('Permission denied: cannot view team.');
  }

  try {
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to fetch team');
  }
});

/**
 * Lightweight version of getTeams — returns team rows without loading members.
 * Use when you only need team_id, team_name, manager_id (e.g., for display badges).
 */
export const getTeamsBasic = withAuth(async (user, { tenant }): Promise<Omit<ITeam, 'members'>[]> => {
  const { knex } = await createTenantKnex();
  const canRead = await hasPermission(user, 'user_settings', 'read', knex);
  if (!canRead) {
    throw new Error('Permission denied: cannot view teams.');
  }

  try {
    return await Team.getAll(knex, tenant);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to fetch teams');
  }
});

export const getTeams = withAuth(async (user, { tenant }): Promise<ITeam[]> => {
  const { knex } = await createTenantKnex();
  const canRead = await hasPermission(user, 'user_settings', 'read', knex);
  if (!canRead) {
    throw new Error('Permission denied: cannot view teams.');
  }

  try {
    const teams = await Team.getAll(knex, tenant);
    const teamsWithMembers = await Promise.all(teams.map(async (team): Promise<ITeam> => {
      const memberEntries = await Team.getMembers(knex, tenant, team.team_id);
      const members = await getUsersWithRoles(knex, tenant, memberEntries);
      return { ...team, members };
    }));
    return teamsWithMembers;
  } catch (error) {
    console.error(error);
    throw new Error('Failed to fetch teams');
  }
});

export interface TeamChanges {
  managerId?: string;
  addUserIds: string[];
  removeUserIds: string[];
}

export const saveTeamChanges = withAuth(async (user, { tenant }, teamId: string, changes: TeamChanges): Promise<ITeam> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    throw new Error('Permission denied: cannot modify team.');
  }

  try {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Assign manager if changed
      if (changes.managerId) {
        await Team.update(trx, tenant, teamId, { manager_id: changes.managerId });

        // Demote any existing leads to 'member'
        await trx('team_members')
          .where({ team_id: teamId, tenant, role: 'lead' })
          .update({ role: 'member' });

        // Add or promote the new manager
        const existingMember = await trx('team_members')
          .where({ team_id: teamId, user_id: changes.managerId, tenant })
          .first();
        if (existingMember) {
          await trx('team_members')
            .where({ team_id: teamId, user_id: changes.managerId, tenant })
            .update({ role: 'lead' });
        } else {
          await Team.addMember(trx, tenant, teamId, changes.managerId, 'lead');
        }
      }

      // Batch remove members
      if (changes.removeUserIds.length > 0) {
        await trx('team_members')
          .where({ team_id: teamId, tenant })
          .whereIn('user_id', changes.removeUserIds)
          .del();
      }

      // Batch add members (with inactive user validation)
      if (changes.addUserIds.length > 0) {
        const activeUsers = await trx('users')
          .select('user_id')
          .where({ tenant, is_inactive: false })
          .whereIn('user_id', changes.addUserIds);

        const activeUserIds = new Set(activeUsers.map((u: { user_id: string }) => u.user_id));
        const inactiveIds = changes.addUserIds.filter(id => !activeUserIds.has(id));
        if (inactiveIds.length > 0) {
          throw new Error('Cannot add inactive users to team');
        }

        await trx('team_members').insert(
          changes.addUserIds.map(userId => ({
            team_id: teamId,
            user_id: userId,
            tenant,
            role: 'member' as const,
          }))
        );
      }
    });

    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to save team changes');
  }
});

export const assignManagerToTeam = withAuth(async (user, { tenant }, teamId: string, userId: string): Promise<ITeam> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    throw new Error('Permission denied: cannot assign team manager.');
  }

  try {

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Update team manager
      await Team.update(trx, tenant, teamId, { manager_id: userId });

      // Demote any existing leads to 'member'
      await trx('team_members')
        .where({ team_id: teamId, tenant, role: 'lead' })
        .update({ role: 'member' });

      // Add or promote the new manager
      const existingMember = await trx('team_members')
        .where({ team_id: teamId, user_id: userId, tenant })
        .first();
      if (existingMember) {
        await trx('team_members')
          .where({ team_id: teamId, user_id: userId, tenant })
          .update({ role: 'lead' });
      } else {
        await Team.addMember(trx, tenant, teamId, userId, 'lead');
      }
    });

    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to assign manager to team');
  }
});
