'use server'

import Team from '@/lib/models/team';
import { ITeam, IUserWithRoles } from '@/interfaces/auth.interfaces';
import { getMultipleUsersWithRoles } from '@/lib/actions/user-actions/userActions';

export async function createTeam(teamData: Omit<ITeam, 'members'> & { members?: IUserWithRoles[] }): Promise<ITeam> {
  try {
    // Extract members from teamData
    const { members, ...teamDataWithoutMembers } = teamData;
    
    // If no manager_id is provided and there are members, use the first member as manager
    if (!teamDataWithoutMembers.manager_id && members && members.length > 0) {
      teamDataWithoutMembers.manager_id = members[0].user_id;
    } else if (!teamDataWithoutMembers.manager_id) {
      throw new Error('A team must have a manager. Please specify a manager_id or provide at least one team member.');
    }
    
    // Create the team first
    const createdTeam = await Team.create(teamDataWithoutMembers);
    
    // If members were provided, add them to the team
    if (members && members.length > 0) {
      await Promise.all(
        members.map((member): Promise<void> => Team.addMember(createdTeam.team_id, member.user_id))
      );
    }
    
    // Return the complete team with members
    return await getTeamById(createdTeam.team_id);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to create team');
  }
}

export async function updateTeam(teamId: string, teamData: Partial<ITeam>): Promise<ITeam> {
  try {
    await Team.update(teamId, teamData);
    return await getTeamById(teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to update team');
  }
}

export async function deleteTeam(teamId: string): Promise<{ success: boolean }> {
  try {
    await Team.delete(teamId);
    return { success: true };
  } catch (error) {
    console.error(error);
    throw new Error('Failed to delete team');
  }
}

export const addUserToTeam = async (teamId: string, userId: string): Promise<ITeam> => {
  try {
    await Team.addMember(teamId, userId);
    return await getTeamById(teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to add user to team');
  }
}

export const removeUserFromTeam = async (teamId: string, userId: string): Promise<ITeam> => {
  try {
    await Team.removeMember(teamId, userId);
    return await getTeamById(teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to remove user from team');
  }
}

export const getTeamById = async (teamId: string): Promise<ITeam> => {
  try {
    const team = await Team.get(teamId);
    if (!team) {
      throw new Error('Team not found');
    }
    const memberIds = await Team.getMembers(teamId);
    const members = await getMultipleUsersWithRoles(memberIds);
    
    return { ...team, members };
  } catch (error) {
    console.error(error);
    throw new Error('Failed to fetch team');
  }
}

export async function getTeams(): Promise<ITeam[]> {
  try {
    const teams = await Team.getAll();
    const teamsWithMembers = await Promise.all(teams.map(async (team): Promise<ITeam> => {
      const memberIds = await Team.getMembers(team.team_id);
      const members = await getMultipleUsersWithRoles(memberIds);
      return { ...team, members };
    }));
    return teamsWithMembers;
  } catch (error) {
    console.error(error);
    throw new Error('Failed to fetch teams');
  }
}

export const assignManagerToTeam = async (teamId: string, userId: string): Promise<ITeam> => {
  try {
    await Team.update(teamId, { manager_id: userId });
    return await getTeamById(teamId);
  } catch (error) {
    console.error(error);
    throw new Error('Failed to assign manager to team');
  }
}
