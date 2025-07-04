/**
 * Team Test Data Factory
 * Creates test data for team-related tests
 */

import { faker } from '@faker-js/faker';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create a single test team
 */
export async function createTestTeam(
  db: Knex,
  tenantId: string,
  overrides: Partial<{
    team_name: string;
    manager_id: string;
  }> = {}
) {
  const teamData = {
    team_id: uuidv4(),
    tenant: tenantId,
    team_name: overrides.team_name || faker.commerce.department() + ' Team',
    manager_id: overrides.manager_id || uuidv4(), // This should be a valid user_id in real tests
    created_at: new Date(),
    updated_at: new Date()
  };

  const [team] = await db('teams').insert(teamData).returning('*');
  return team;
}

/**
 * Create multiple test teams
 */
export async function createTestTeams(
  db: Knex,
  tenantId: string,
  count: number,
  managerId: string
) {
  const teams = [];
  for (let i = 0; i < count; i++) {
    const team = await createTestTeam(db, tenantId, { manager_id: managerId });
    teams.push(team);
  }
  return teams;
}

/**
 * Create test team data for API calls
 */
export function createTeamTestData(overrides: Partial<{
  team_name: string;
  manager_id: string;
}> = {}) {
  return {
    team_name: overrides.team_name || faker.commerce.department() + ' Team',
    manager_id: overrides.manager_id || uuidv4()
  };
}

/**
 * Add a member to a team
 */
export async function addTeamMember(
  db: Knex,
  tenantId: string,
  teamId: string,
  userId: string
) {
  await db('team_members').insert({
    tenant: tenantId,
    team_id: teamId,
    user_id: userId,
    created_at: new Date()
  });
}

/**
 * Create teams for pagination testing
 */
export async function createTeamsForPagination(
  db: Knex,
  tenantId: string,
  managerId: string,
  count: number = 30
) {
  const teams = [];
  for (let i = 0; i < count; i++) {
    const team = await createTestTeam(db, tenantId, {
      team_name: `Pagination Team ${i + 1}`,
      manager_id: managerId
    });
    teams.push(team);
  }
  return teams;
}

/**
 * Create a team hierarchy
 */
export async function createTeamHierarchy(
  db: Knex,
  tenantId: string,
  managerId: string
) {
  // Note: The current teams table doesn't have parent_team_id
  // This is a placeholder for when hierarchy is implemented
  const rootTeam = await createTestTeam(db, tenantId, {
    team_name: 'Root Team',
    manager_id: managerId
  });

  const childTeam1 = await createTestTeam(db, tenantId, {
    team_name: 'Child Team 1',
    manager_id: managerId
  });

  const childTeam2 = await createTestTeam(db, tenantId, {
    team_name: 'Child Team 2',
    manager_id: managerId
  });

  return { rootTeam, childTeam1, childTeam2 };
}

/**
 * Clean up test teams
 */
export async function cleanupTestTeams(db: Knex, tenantId: string) {
  // Delete team members first due to foreign key constraints
  await db('team_members').where({ tenant: tenantId }).delete();
  
  // Then delete teams
  await db('teams').where({ tenant: tenantId }).delete();
}