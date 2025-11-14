// Import mocks first to ensure they're hoisted
import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createProject } from 'server/src/lib/actions/project-actions/projectActions';
import { IProject } from 'server/src/interfaces/project.interfaces';
import { TestContext } from 'server/test-utils/testContext';
import { setupCommonMocks } from 'server/test-utils/testMocks';

describe('Project Actions Integration - Project Numbers', () => {
  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext
  } = TestContext.createHelpers();

  let context: TestContext;
  let testClientId: string;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: ['projects', 'clients']
    });

    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true
    });
  }, 120000); // Increase timeout to 2 minutes for setup

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true
    });

    // Ensure project statuses exist for test tenant
    const existingStatuses = await context.db('statuses')
      .where({ tenant: context.tenantId, status_type: 'project' })
      .count('* as count')
      .first();

    if (!existingStatuses || existingStatuses.count === '0') {
      // Insert test project statuses
      await context.db('statuses').insert([
        {
          tenant: context.tenantId,
          name: 'Planning',
          status_type: 'project',
          order_number: 1,
          created_by: context.userId,
          is_closed: false,
          is_default: true
        },
        {
          tenant: context.tenantId,
          name: 'In Progress',
          status_type: 'project',
          order_number: 2,
          created_by: context.userId,
          is_closed: false
        },
        {
          tenant: context.tenantId,
          name: 'Completed',
          status_type: 'project',
          order_number: 3,
          created_by: context.userId,
          is_closed: true
        }
      ]);
    }

    // Get or use the test client (context.clientId from TestContext)
    testClientId = context.clientId;

    // Configure project numbering with correct format
    await context.db('next_number')
      .insert({
        tenant: context.tenantId,
        entity_type: 'PROJECT',
        last_number: 0,
        initial_value: 1,
        prefix: 'PRJ',
        padding_length: 4
      })
      .onConflict(['tenant', 'entity_type'])
      .merge({
        prefix: 'PRJ',
        padding_length: 4
      });
  });

  afterEach(async () => {
    await rollbackContext();
  });

  afterAll(async () => {
    await cleanupContext();
  });

  describe('createProject with numbering', () => {
    it('should create project with auto-generated project_number', async () => {
      const projectData = {
        project_name: 'Test Project for Numbering',
        client_id: testClientId,
        status: 'planning',
        wbs_code: 'TEST-001',
        description: null,
        start_date: null,
        end_date: null,
        is_inactive: false
      };

      const project = await createProject(projectData as any);

      // Verify project was created with project_number
      const dbProject = await context.db('projects')
        .where({ project_id: project.project_id, tenant: context.tenantId })
        .first();

      expect(dbProject).toBeDefined();
      expect(dbProject.project_number).toBeDefined();
      expect(dbProject.project_number).toMatch(/^PRJ\d{4}$/);
      expect(dbProject.project_name).toBe('Test Project for Numbering');
    });

    it('should create multiple projects with sequential numbers', async () => {
      const projectData = {
        project_name: 'Test Project',
        client_id: testClientId,
        status: 'planning',
        wbs_code: 'TEST',
        description: null,
        start_date: null,
        end_date: null,
        is_inactive: false
      };

      const project1 = await createProject({ ...projectData, project_name: 'Project 1' } as any);
      const project2 = await createProject({ ...projectData, project_name: 'Project 2' } as any);
      const project3 = await createProject({ ...projectData, project_name: 'Project 3' } as any);

      const projects = await context.db('projects')
        .whereIn('project_id', [project1.project_id, project2.project_id, project3.project_id])
        .where('tenant', context.tenantId)
        .orderBy('project_number');

      expect(projects).toHaveLength(3);

      // Extract numbers and verify they're sequential
      const numbers = projects.map((p: any) => parseInt(p.project_number.split('-')[1]));
      expect(numbers[1]).toBe(numbers[0] + 1);
      expect(numbers[2]).toBe(numbers[1] + 1);
    });

    it('should enforce unique project_number per tenant', async () => {
      // Try to insert duplicate project_number
      await expect(
        context.db('projects').insert({
          project_id: '00000000-0000-0000-0000-000000000099',
          project_name: 'Duplicate Number Test',
          client_id: testClientId,
          project_number: 'PRJ-0001',
          tenant: context.tenantId,
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
        wbs_code: 'TEST-RET',
        description: null,
        start_date: null,
        end_date: null,
        is_inactive: false
      };

      const project = await createProject(projectData as any);

      expect(project.project_number).toBeDefined();
      expect(typeof project.project_number).toBe('string');
      expect(project.project_number).toMatch(/^PRJ\d{4}$/);
    });
  });
});
