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

  const result = await db('projects')
    .insert({
      project_id: project.project_id,
      tenant: project.tenant,
      company_id: project.company_id,
      project_name: project.project_name,
      description: project.description,
      status: project.status,
      start_date: project.start_date,
      end_date: project.end_date,
      is_inactive: project.is_inactive,
      created_at: project.created_at,
      updated_at: project.updated_at
    })
    .returning('*');

  return result[0];
}