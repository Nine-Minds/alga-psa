import { createProject } from 'server/src/lib/actions/project-actions/projectActions';
import { createTenantKnex } from 'server/src/lib/db';
import { IProject } from 'server/src/interfaces/project.interfaces';

describe('Project Actions Integration - Project Numbers', () => {
  let testClientId: string;

  beforeAll(async () => {
    // Setup: Create a test client
    const { knex, tenant } = await createTenantKnex();
    const [client] = await knex('clients')
      .where('tenant', tenant)
      .limit(1);
    testClientId = client.client_id;
  });

  describe('createProject with numbering', () => {
    it('should create project with auto-generated project_number', async () => {
      const projectData = {
        project_name: 'Test Project for Numbering',
        client_id: testClientId,
        status: 'planning',
        wbs_code: 'TEST-001'
      };

      const project = await createProject(projectData as any);

      // Verify project was created with project_number
      const { knex, tenant } = await createTenantKnex();
      const dbProject = await knex('projects')
        .where({ project_id: project.project_id, tenant })
        .first();

      expect(dbProject).toBeDefined();
      expect(dbProject.project_number).toBeDefined();
      expect(dbProject.project_number).toMatch(/^PRJ-\d{4}$/);
      expect(dbProject.project_name).toBe('Test Project for Numbering');
    });

    it('should create multiple projects with sequential numbers', async () => {
      const projectData = {
        project_name: 'Test Project',
        client_id: testClientId,
        status: 'planning',
        wbs_code: 'TEST'
      };

      const project1 = await createProject({ ...projectData, project_name: 'Project 1' } as any);
      const project2 = await createProject({ ...projectData, project_name: 'Project 2' } as any);
      const project3 = await createProject({ ...projectData, project_name: 'Project 3' } as any);

      const { knex, tenant } = await createTenantKnex();
      const projects = await knex('projects')
        .whereIn('project_id', [project1.project_id, project2.project_id, project3.project_id])
        .where('tenant', tenant)
        .orderBy('project_number');

      expect(projects).toHaveLength(3);

      // Extract numbers and verify they're sequential
      const numbers = projects.map((p: any) => parseInt(p.project_number.split('-')[1]));
      expect(numbers[1]).toBe(numbers[0] + 1);
      expect(numbers[2]).toBe(numbers[1] + 1);
    });

    it('should enforce unique project_number per tenant', async () => {
      const { knex, tenant } = await createTenantKnex();

      // Try to insert duplicate project_number
      await expect(
        knex('projects').insert({
          project_id: '00000000-0000-0000-0000-000000000099',
          project_name: 'Duplicate Number Test',
          client_id: testClientId,
          project_number: 'PRJ-0001',
          tenant,
          wbs_code: 'DUP-001'
        })
      ).rejects.toThrow();
    });
  });

  describe('project_number field validation', () => {
    it('should include project_number in returned project object', async () => {
      const projectData = {
        project_name: 'Test Project Return Value',
        client_id: testClientId,
        status: 'planning',
        wbs_code: 'TEST-RET'
      };

      const project = await createProject(projectData as any);

      expect(project.project_number).toBeDefined();
      expect(typeof project.project_number).toBe('string');
      expect(project.project_number).toMatch(/^PRJ-\d{4}$/);
    });
  });
});
