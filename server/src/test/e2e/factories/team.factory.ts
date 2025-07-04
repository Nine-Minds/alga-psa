/**
 * Team Factory for E2E Tests
 * Creates team test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface TeamInput {
  tenant: string;
  team_name?: string;
  description?: string;
  manager_id?: string;
  parent_team_id?: string | null;
  is_active?: boolean;
}

export async function teamFactory(db: any, input: TeamInput) {
  const team = {
    team_id: faker.string.uuid(),
    tenant: input.tenant,
    team_name: input.team_name || faker.company.name() + ' Team',
    description: input.description || faker.lorem.sentence(),
    manager_id: input.manager_id || null,
    parent_team_id: input.parent_team_id !== undefined ? input.parent_team_id : null,
    is_active: input.is_active !== undefined ? input.is_active : true,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('teams')
    .insert({
      team_id: team.team_id,
      tenant: team.tenant,
      team_name: team.team_name,
      description: team.description,
      manager_id: team.manager_id,
      parent_team_id: team.parent_team_id,
      is_active: team.is_active,
      created_at: team.created_at,
      updated_at: team.updated_at
    })
    .returning('*');

  return result[0];
}