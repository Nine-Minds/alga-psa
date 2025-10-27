import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { IProject } from '../../interfaces/project.interfaces';
import * as projectActions from '@product/actions/project-actions/projectActions';
import * as userActions from '@product/actions/user-actions/userActions';
import { TestContext } from '../../../../test-utils/testContext';
import {
  setupCommonMocks,
  mockNextHeaders,
  mockNextAuth,
  mockRBAC,
  createMockUser
} from '../../../../test-utils/testMocks';
import {
  createTenant,
  createClient,
  createUser,
  createTestEnvironment
} from '../../../../test-utils/testDataFactory';
import {
  resetDatabase,
  createCleanupHook,
  cleanupTables
} from '../../../../test-utils/dbReset';
import {
  expectPermissionDenied,
  expectError
} from '../../../../test-utils/errorUtils';

describe('Project Permissions Infrastructure', () => {
  const context = new TestContext({
    cleanupTables: ['projects', 'clients', 'users', 'roles', 'permissions'],
    runSeeds: true
  });
  let testProject: IProject;
  let regularUser: any;
  let adminUser: any;

  // Set up test context with database connection
  beforeAll(async () => {
    await context.initialize();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  beforeEach(async () => {
    // Reset database state
    await resetDatabase(context.db);

    // Set up common test environment
    const { tenantId, clientId } = await createTestEnvironment(context.db, {
      clientName: 'Test Client'
    });

    // Create users with different roles
    const regularUserId = await createUser(context.db, tenantId, {
      username: 'johndoe',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      user_type: 'internal'
    });

    const adminUserId = await createUser(context.db, tenantId, {
      username: 'janeadmin',
      first_name: 'Jane',
      last_name: 'Admin',
      email: 'jane@example.com',
      user_type: 'internal'
    });

    // Get complete user objects from database
    regularUser = await context.db('users')
      .select('users.*')
      .leftJoin('user_roles', 'users.user_id', 'user_roles.user_id')
      .leftJoin('roles', 'user_roles.role_id', 'roles.role_id')
      .where('users.user_id', regularUserId)
      .first();

    adminUser = await context.db('users')
      .select('users.*')
      .leftJoin('user_roles', 'users.user_id', 'user_roles.user_id')
      .leftJoin('roles', 'user_roles.role_id', 'roles.role_id')
      .where('users.user_id', adminUserId)
      .first();

    // Set up mocks
    setupCommonMocks({
      tenantId,
      user: createMockUser('admin')
    });

    // Mock RBAC with proper type annotations
    mockRBAC((user: { username: string }, resource: string, action: string): boolean => {
      if (user.username === 'janeadmin') return true;
      if (user.username === 'johndoe' && resource === 'project' && action === 'read') return true;
      return false;
    });

    // Create test project
    const initiatingSpellStatus = await context.db('statuses')
      .where('name', 'Initiating Spell')
      .first();

    if (!initiatingSpellStatus) {
      throw new Error('Initiating Spell status not found');
    }

    testProject = {
      tenant: tenantId,
      project_id: uuidv4(),
      client_id: clientId,
      project_name: 'Test Project',
      description: 'A test project',
      start_date: new Date(),
      end_date: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
      wbs_code: 'TEST-001',
      is_inactive: false,
      status: initiatingSpellStatus.status_id
    };

    await context.db('projects').insert(testProject);
  });

  // Use cleanup hook for test isolation
  const cleanup = createCleanupHook(context.db, ['projects', 'clients', 'users', 'roles', 'permissions']);
  afterEach(cleanup);

  it('should allow regular user to view projects', async () => {
    vi.spyOn(userActions, 'getCurrentUser').mockResolvedValue(regularUser);
    const projects = await projectActions.getProjects();
    expect(projects.length).toBeGreaterThanOrEqual(1);
    expect(projects.map((project): string => project.project_id)).toContain(testProject.project_id);
  });

  it('should allow admin user to edit a project', async () => {
    vi.spyOn(userActions, 'getCurrentUser').mockResolvedValue(adminUser);
    const updateData: Partial<IProject> = {
      project_name: 'Updated Test Project',
    };
    const result = await projectActions.updateProject(testProject.project_id, updateData);
    expect(result.project_name).toBe('Updated Test Project');

    const updatedProject = await context.db('projects').where('project_id', testProject.project_id).first();
    expect(updatedProject.project_name).toBe('Updated Test Project');
  });

  it('should not allow regular user to edit a project', async () => {
    vi.spyOn(userActions, 'getCurrentUser').mockResolvedValue(regularUser);
    const updateData: Partial<IProject> = {
      project_name: 'Updated Test Project',
    };

    await expectPermissionDenied(
      () => projectActions.updateProject(testProject.project_id, updateData)
    );

    const unchangedProject = await context.db('projects').where('project_id', testProject.project_id).first();
    expect(unchangedProject.project_name).toBe(testProject.project_name);
  });

  it('should allow admin user to create a project', async () => {
    vi.spyOn(userActions, 'getCurrentUser').mockResolvedValue(adminUser);
    const { tenantId } = context;
    
    const newProjectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at'> = {
      tenant: tenantId,
      client_id: testProject.client_id,
      project_name: 'New Test Project',
      description: 'A new test project',
      start_date: new Date(),
      end_date: new Date(),
      wbs_code: 'TEST-002',
      is_inactive: false,
      status: testProject.status
    };

    const newProject = await projectActions.createProject(newProjectData);
    expect(newProject).toBeDefined();
    expect(newProject.project_name).toBe('New Test Project');

    const retrievedProject = await context.db('projects').where('project_id', newProject.project_id).first();
    expect(retrievedProject.project_id).toEqual(newProject.project_id);
  });

  it('should not allow regular user to create a project', async () => {
    vi.spyOn(userActions, 'getCurrentUser').mockResolvedValue(regularUser);
    const { tenantId } = context;

    const newProjectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at'> = {
      tenant: tenantId,
      client_id: testProject.client_id,
      project_name: 'New Test Project',
      description: 'A new test project',
      start_date: new Date(),
      end_date: new Date(),
      wbs_code: 'TEST-002',
      is_inactive: false,
      status: testProject.status
    };

    await expectPermissionDenied(
      () => projectActions.createProject(newProjectData)
    );
  });

  it('should allow admin user to delete a project', async () => {
    vi.spyOn(userActions, 'getCurrentUser').mockResolvedValue(adminUser);
    await projectActions.deleteProject(testProject.project_id);

    const deletedProject = await context.db('projects').where('project_id', testProject.project_id).first();
    expect(deletedProject).toBeUndefined();
  });

  it('should not allow regular user to delete a project', async () => {
    vi.spyOn(userActions, 'getCurrentUser').mockResolvedValue(regularUser);
    
    await expectPermissionDenied(
      () => projectActions.deleteProject(testProject.project_id)
    );

    const unchangedProject = await context.db('projects').where('project_id', testProject.project_id).first();
    expect(unchangedProject).toBeDefined();
  });
});
