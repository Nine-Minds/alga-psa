import { describe, expect, it } from 'vitest';
import { projectRecord } from '@/lib/api/controllers/projectRecord';
import { buildAuthorizationAwarePage } from '@alga-psa/authorization/pagination';

const project = {
  project_id: 'project-1',
  project_name: 'Migration',
  description: 'Confidential scope',
  budgeted_hours: 80,
  client_id: 'client-1',
  client_name: 'Northwind',
  status: 'status-1',
  status_name: 'Active',
};

describe('projectRecord REST projection', () => {
  it('preserves unrestricted records and removes canonical and relation-qualified hidden fields', () => {
    expect(projectRecord(project, [])).toEqual(project);
    const projected = projectRecord(project, ['fields.description', 'projects.budgeted_hours']);
    expect(projected).not.toHaveProperty('description');
    expect(projected).not.toHaveProperty('budgeted_hours');
    expect(projected).toMatchObject({ project_id: project.project_id, project_name: project.project_name });
  });

  it('hides derived names when their source identifiers are hidden', () => {
    expect(projectRecord(project, ['client_id'])).toEqual(expect.not.objectContaining({ client_id: expect.anything(), client_name: expect.anything() }));
    expect(projectRecord(project, ['statuses.name'])).toEqual(expect.not.objectContaining({ status_name: expect.anything() }));
  });

  it('suppresses rows when the project resource or identifier is hidden', () => {
    expect(projectRecord(project, ['projects'])).toBeNull();
    expect(projectRecord(project, ['fields.project_id'])).toBeNull();
  });

  it('paginates and serializes only allowed projected rows', async () => {
    const page = await buildAuthorizationAwarePage<Record<string, any>>({
      page: 1,
      limit: 10,
      fetchPage: async () => ({ data: [project, { ...project, project_id: 'project-2' }], total: 2 }),
      authorizeRecord: async (row) => ({
        allowed: row.project_id === 'project-1',
        redactedFields: ['projects.description', 'budgeted_hours'],
      }),
      projectRecord: (row, redactions) => projectRecord(row, redactions),
    });

    expect(page.total).toBe(1);
    expect(JSON.parse(JSON.stringify(page.data))).toEqual([{
      project_id: 'project-1',
      project_name: 'Migration',
      client_id: 'client-1',
      client_name: 'Northwind',
      status: 'status-1',
      status_name: 'Active',
    }]);
  });
});
