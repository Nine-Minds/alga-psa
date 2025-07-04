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

  const result = await db.query(
    `INSERT INTO teams (
      team_id, tenant, team_name, description, 
      manager_id, parent_team_id, is_active, 
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9
    ) RETURNING *`,
    [
      team.team_id,
      team.tenant,
      team.team_name,
      team.description,
      team.manager_id,
      team.parent_team_id,
      team.is_active,
      team.created_at,
      team.updated_at
    ]
  );

  return result.rows[0];
}