import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IUser, IUserWithRoles, IRoleWithPermissions, IPermission, IRole, IProject } from '@alga-psa/types';
import * as projectActions from '@alga-psa/projects/actions/projectActions';
import ProjectModel from '@alga-psa/projects/models/project';

// Mock the Project model methods
vi.mock('@alga-psa/projects/models/project', () => ({
  default: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    generateNextWbsCode: vi.fn().mockResolvedValue('WBS-001'),
    getStandardStatusesByType: vi.fn().mockResolvedValue([
      {
        standard_status_id: 'SS-1',
        name: 'To Do',
        item_type: 'project_task',
        display_order: 1,
        is_closed: false,
        tenant: '550e8400-e29b-41d4-a716-446655440000'
      },
      {
        standard_status_id: 'SS-2',
        name: 'In Progress',
        item_type: 'project_task',
        display_order: 2,
        is_closed: false,
        tenant: '550e8400-e29b-41d4-a716-446655440000'
      }
    ]),
    getStatusesByType: vi.fn().mockResolvedValue([
      {
        status_id: 'S-1',
        name: 'Active',
        item_type: 'project',
        is_closed: false,
        tenant: '550e8400-e29b-41d4-a716-446655440000'
      }
    ]),
    addProjectStatusMapping: vi.fn().mockResolvedValue({
      project_status_mapping_id: 'PSM-1',
      project_id: 'P-1',
      standard_status_id: 'SS-1',
      is_standard: true,
      custom_name: null,
      display_order: 1,
      is_visible: true
    })
  },
}));

// Mock the userActions with both required functions
vi.mock('@alga-psa/users/actions', () => ({
  getAllUsers: vi.fn().mockResolvedValue([]),
  findUserById: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn().mockImplementation(async (user: IUser, resource: string, action: string): Promise<boolean> => {
    if (!user || !('roles' in user)) return false;
    const userWithRoles = user as IUserWithRoles;

    return userWithRoles.roles.some((role) => {
      if (!('permissions' in role)) return false;
      const roleWithPermissions = role as IRoleWithPermissions;
      return roleWithPermissions.permissions.some(
        (permission) => permission.resource === resource && permission.action === action,
      );
    });
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Mock the SharedNumberingService
vi.mock('@shared/services/numberingService', () => ({
  SharedNumberingService: {
    getNextNumber: vi.fn().mockResolvedValue('PRJ-0001'),
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn().mockResolvedValue({
    knex: {
      transaction: vi.fn().mockImplementation((callback: any) => callback({})),
    },
    tenant: '550e8400-e29b-41d4-a716-446655440000'
  }),
  withTransaction: vi.fn().mockImplementation(async (knex, callback) => callback({})),
}));

import { getCurrentUser } from '@alga-psa/auth';

describe('Project Permissions', () => {
  let viewProjectPermission: IPermission;
  let editProjectPermission: IPermission;
  let createProjectPermission: IPermission;
  let deleteProjectPermission: IPermission;
  let userRole: IRoleWithPermissions;
  let adminRole: IRoleWithPermissions;
  let regularUser: IUserWithRoles;
  let adminUser: IUserWithRoles;
  let userWithoutPermissions: IUserWithRoles;
  let userWithoutCreatePermission: IUserWithRoles;
  let mockProject: IProject;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create project-specific permissions
    viewProjectPermission = { 
      permission_id: '1', 
      resource: 'project', 
      action: 'read',
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      msp: true,
      client: false
    };
    editProjectPermission = { 
      permission_id: '2', 
      resource: 'project', 
      action: 'update',
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      msp: true,
      client: false
    };
    createProjectPermission = { 
      permission_id: '3', 
      resource: 'project', 
      action: 'create',
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      msp: true,
      client: false
    };
    deleteProjectPermission = { 
      permission_id: '4', 
      resource: 'project', 
      action: 'delete',
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      msp: true,
      client: false
    };

    // Create roles with project permissions
    userRole = {
      role_id: '1',
      role_name: 'User',
      description: 'Regular user role with view project permission',
      permissions: [viewProjectPermission],
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      msp: true,
      client: false
    };

    adminRole = {
      role_id: '2',
      role_name: 'Admin',
      description: 'Administrator role with all project permissions',
      permissions: [viewProjectPermission, editProjectPermission, createProjectPermission, deleteProjectPermission],
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      msp: true,
      client: false
    };

    // Create users with specific roles
    regularUser = {
      user_id: '11111111-1111-1111-1111-111111111111',
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      username: 'johndoe',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      hashed_password: 'hashed_password_here',
      user_type: 'user',
      roles: [userRole],
      is_inactive: false
    };

    adminUser = {
      user_id: '22222222-2222-2222-2222-222222222222',
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      username: 'janeadmin',
      first_name: 'Jane',
      last_name: 'Admin',
      email: 'jane@example.com',
      hashed_password: 'hashed_password_here',
      user_type: 'admin',
      roles: [adminRole],
      is_inactive: false
    };

    userWithoutPermissions = {
      user_id: '33333333-3333-3333-3333-333333333333',
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      username: 'nopermissions',
      first_name: 'No',
      last_name: 'Permissions',
      email: 'no@permissions.com',
      hashed_password: 'hashed_password_here',
      is_inactive: false,
      user_type: 'user',
      roles: [] // Empty roles array - no permissions at all
    };

    userWithoutCreatePermission = {
      user_id: '44444444-4444-4444-4444-444444444444',
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      username: 'nocreate',
      first_name: 'No',
      last_name: 'Create',
      email: 'no@create.com',
      hashed_password: 'hashed_password_here',
      is_inactive: false,
      user_type: 'user',
      roles: [userRole] // Has read permission but not create, update, or delete
    };

    mockProject = {
      tenant: '550e8400-e29b-41d4-a716-446655440000',
      project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      client_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      project_name: 'Test Project',
      description: 'This is a test project',
      start_date: new Date(),
      end_date: null,
      status: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      created_at: new Date(),
      updated_at: new Date(),
      wbs_code: 'WBS-001',
      is_inactive: false
    };

    // Mock ProjectModel methods
    vi.mocked(ProjectModel.getAll).mockResolvedValue([mockProject]);
    vi.mocked(ProjectModel.getById).mockResolvedValue(mockProject);
    vi.mocked(ProjectModel.create).mockResolvedValue(mockProject);
    vi.mocked(ProjectModel.update).mockResolvedValue(mockProject);
    vi.mocked(ProjectModel.delete).mockResolvedValue(undefined);
  });

  it('should allow regular user to view projects', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(regularUser);
    const projects = await projectActions.getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual(mockProject);
  });

  it('should allow admin user to view projects', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    const projects = await projectActions.getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual(mockProject);
  });

  it('should throw an error if user does not have view permission', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(userWithoutPermissions);
    await expect(projectActions.getProjects()).rejects.toThrow('Permission denied: Cannot read project');
  });

  it('should allow regular user to view a specific project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(regularUser);
    const project = await projectActions.getProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(project).toEqual(mockProject);
  });

  it('should allow admin user to view a specific project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    const project = await projectActions.getProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(project).toEqual(mockProject);
  });

  it('should throw an error if user does not have view permission for a specific project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(userWithoutPermissions);
    await expect(projectActions.getProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).rejects.toThrow('Permission denied: Cannot read project');
  });

  const updateData: Partial<IProject> = {
    project_name: 'Updated Project Name',
    updated_at: new Date()
  };

  it('should allow admin user to edit a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    const result = await projectActions.updateProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', updateData);
    expect(result).toEqual(mockProject);
  });

  it('should not allow regular user to edit a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(regularUser);
    await expect(projectActions.updateProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', updateData)).rejects.toThrow('Permission denied: Cannot update project');
  });

  it('should throw an error if user does not have edit permission', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(userWithoutPermissions);
    await expect(projectActions.updateProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', updateData)).rejects.toThrow('Permission denied: Cannot update project');
  });

  const newProjectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at'> = {
    tenant: '550e8400-e29b-41d4-a716-446655440000',
    client_id: 'COMP-1',
    project_name: 'New Project',
    description: 'This is a new project',
    start_date: new Date(),
    end_date: null,
    status: 'STATUS-1',
    wbs_code: 'WBS-002',
    is_inactive: false
  };

  it('should allow admin user to create a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    const result = await projectActions.createProject(newProjectData);
    expect(result).toEqual(mockProject);
  });

  it('should not allow regular user to create a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(regularUser);
    await expect(projectActions.createProject(newProjectData)).rejects.toThrow('Permission denied: Cannot create project');
  });

  it('should throw an error if user does not have create permission', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(userWithoutCreatePermission);
    await expect(projectActions.createProject(newProjectData)).rejects.toThrow('Permission denied: Cannot create project');
  });

  it('should allow admin user to delete a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    await expect(projectActions.deleteProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).resolves.toBeUndefined();
  });

  it('should not allow regular user to delete a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(regularUser);
    await expect(projectActions.deleteProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).rejects.toThrow('Permission denied: Cannot delete project');
  });

  it('should throw an error if user does not have delete permission', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(userWithoutPermissions);
    await expect(projectActions.deleteProject('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).rejects.toThrow('Permission denied: Cannot delete project');
  });
});
