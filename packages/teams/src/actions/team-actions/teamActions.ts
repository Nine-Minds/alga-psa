'use server'

import Team from '../../models/team';
import type { IRole, ITeam, IUser, IUserWithRoles } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';

async function getUsersWithRoles(
  trx: Knex | Knex.Transaction,
  tenant: string,
  userIds: string[],
): Promise<IUserWithRoles[]> {
  if (userIds.length === 0) {
    return [];
  }

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

  return users.map((user) => ({
    ...(user as any),
    roles: rolesByUser.get(user.user_id) ?? [],
  }));
}

export const createTeam = withAuth(async (user, { tenant }, teamData: Omit<ITeam, 'members'> & { members?: IUserWithRoles[] }): Promise<ITeam> => {
  try {
    // Extract members from teamData
    const { members, ...teamDataWithoutMembers } = teamData;

    // If no manager_id is provided and there are members, use the first member as manager
    if (!teamDataWithoutMembers.manager_id && members && members.length > 0) {
      teamDataWithoutMembers.manager_id = members[0].user_id;
    } else if (!teamDataWithoutMembers.manager_id) {
      throw new Error('A team must have a manager. Please specify a manager_id or provide at least one team member.');
    }

    const { knex: db } = await createTenantKnex();

    const createdTeam = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Create the team first
      const team = await Team.create(trx, tenant, teamDataWithoutMembers);

      // Collect all member IDs including the manager
      const allMemberIds = new Set<string>();

      // Add provided members
      if (members && members.length > 0) {
        members.forEach(member => allMemberIds.add(member.user_id));
      }

      // Add manager as a member if specified
      if (teamDataWithoutMembers.manager_id) {
        allMemberIds.add(teamDataWithoutMembers.manager_id);
      }

      // Add all members to the team
      if (allMemberIds.size > 0) {
        await Promise.all(
          Array.from(allMemberIds).map((userId): Promise<void> => Team.addMember(trx, tenant, team.team_id, userId))
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
  const memberIds = await Team.getMembers(knex, tenant, teamId);
  const members = await getUsersWithRoles(knex, tenant, memberIds);

  return { ...team, members };
}

export const updateTeam = withAuth(async (user, { tenant }, teamId: string, teamData: Partial<ITeam>): Promise<ITeam> => {
  try {
    const { knex } = await createTenantKnex();
    await Team.update(knex, tenant, teamId, teamData);
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to update team');
  }
});

export const deleteTeam = withAuth(async (user, { tenant }, teamId: string): Promise<{ success: boolean }> => {
  try {
    const { knex } = await createTenantKnex();
    await Team.delete(knex, tenant, teamId);
    return { success: true };
  } catch (error) {
    console.error(error);
    throw new Error('Failed to delete team');
  }
});

export const addUserToTeam = withAuth(async (user, { tenant }, teamId: string, userId: string): Promise<ITeam> => {
  try {
    const { knex } = await createTenantKnex();
    await Team.addMember(knex, tenant, teamId, userId);
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to add user to team');
  }
});

export const removeUserFromTeam = withAuth(async (user, { tenant }, teamId: string, userId: string): Promise<ITeam> => {
  try {
    const { knex } = await createTenantKnex();
    await Team.removeMember(knex, tenant, teamId, userId);
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to remove user from team');
  }
});

export const getTeamById = withAuth(async (user, { tenant }, teamId: string): Promise<ITeam> => {
  try {
    const { knex } = await createTenantKnex();
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to fetch team');
  }
});

export const getTeams = withAuth(async (user, { tenant }): Promise<ITeam[]> => {
  try {
    const { knex } = await createTenantKnex();
    const teams = await Team.getAll(knex, tenant);
    const teamsWithMembers = await Promise.all(teams.map(async (team): Promise<ITeam> => {
      const memberIds = await Team.getMembers(knex, tenant, team.team_id);
      const members = await getUsersWithRoles(knex, tenant, memberIds);
      return { ...team, members };
    }));
    return teamsWithMembers;
  } catch (error) {
    console.error(error);
    throw new Error('Failed to fetch teams');
  }
});

export const assignManagerToTeam = withAuth(async (user, { tenant }, teamId: string, userId: string): Promise<ITeam> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Update team manager
      await Team.update(trx, tenant, teamId, { manager_id: userId });

      // Check if manager is already a team member
      const existingMember = await trx('team_members')
        .where({ team_id: teamId, user_id: userId })
        .first();

      // Add manager as team member if they're not already a member
      if (!existingMember) {
        await Team.addMember(trx, tenant, teamId, userId);
      }
    });

    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to assign manager to team');
  }
});
