/**
 * Project Factory for E2E Tests
 * Creates project test data with realistic values
 */

import { faker } from '@faker-js/faker';

interface ProjectInput {
  tenant: string;
  company_id: string;
  project_name?: string;
  description?: string;
  status?: string;
  start_date?: Date;
  end_date?: Date;
  is_inactive?: boolean;
}

export async function projectFactory(db: any, input: ProjectInput) {
  const project = {
    project_id: faker.string.uuid(),
    tenant: input.tenant,
    company_id: input.company_id,
    project_name: input.project_name || faker.company.catchPhrase() + ' Project',
    description: input.description || faker.lorem.paragraph(),
    status: input.status || 'active',
    start_date: input.start_date || faker.date.recent({ days: 30 }),
    end_date: input.end_date || faker.date.future({ years: 1 }),
    is_inactive: input.is_inactive !== undefined ? input.is_inactive : false,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db.query(
    `INSERT INTO projects (
      project_id, tenant, company_id, project_name, 
      description, status, start_date, end_date, 
      is_inactive, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
    ) RETURNING *`,
    [
      project.project_id,
      project.tenant,
      project.company_id,
      project.project_name,
      project.description,
      project.status,
      project.start_date,
      project.end_date,
      project.is_inactive,
      project.created_at,
      project.updated_at
    ]
  );

  return result.rows[0];
}