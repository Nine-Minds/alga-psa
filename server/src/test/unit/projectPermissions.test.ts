import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IUser, IUserWithRoles, IRoleWithPermissions, IPermission, IRole } from '../../interfaces/auth.interfaces';
import { IProject } from '../../interfaces/project.interfaces';
import * as projectActions from '@product/actions/project-actions/projectActions';
import ProjectModel from '../../lib/models/project';

// Mock the Project model methods
vi.mock('../../lib/models/project', () => ({
  default: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getStandardStatusesByType: vi.fn().mockResolvedValue([
      {
        standard_status_id: 'SS-1',
        name: 'To Do',
        item_type: 'project_task',
        display_order: 1,
        is_closed: false,
        tenant: 'test-tenant'
      },
      {
        standard_status_id: 'SS-2',
        name: 'In Progress',
        item_type: 'project_task',
        display_order: 2,
        is_closed: false,
        tenant: 'test-tenant'
      }
    ]),
    getStatusesByType: vi.fn().mockResolvedValue([
      {
        status_id: 'S-1',
        name: 'Active',
        item_type: 'project',
        is_closed: false,
        tenant: 'test-tenant'
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
vi.mock('@product/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(),
  getAllUsers: vi.fn().mockResolvedValue([]),
}));

// Mock the RBAC functions with proper permission checking that always returns a boolean
vi.mock('../../lib/auth/rbac', () => ({
  hasPermission: vi.fn().mockImplementation(async (user: IUser, resource: string, action: string): Promise<boolean> => {
    if (!user || !('roles' in user)) return false;
    const userWithRoles = user as IUserWithRoles;
    
    return userWithRoles.roles.some(role => {
      if (!('permissions' in role)) return false;
      const roleWithPermissions = role as IRoleWithPermissions;
      return roleWithPermissions.permissions.some(permission => 
        permission.resource === resource && permission.action === action
      );
    });
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Import getCurrentUser after mocking
import { getCurrentUser } from '@product/actions/user-actions/userActions';

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
  let mockProject: IProject;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create project-specific permissions
    viewProjectPermission = { 
      permission_id: '1', 
      resource: 'project', 
      action: 'read',
      tenant: 'test-tenant',
      msp: true,
      client: false
    };
    editProjectPermission = { 
      permission_id: '2', 
      resource: 'project', 
      action: 'update',
      tenant: 'test-tenant',
      msp: true,
      client: false
    };
    createProjectPermission = { 
      permission_id: '3', 
      resource: 'project', 
      action: 'create',
      tenant: 'test-tenant',
      msp: true,
      client: false
    };
    deleteProjectPermission = { 
      permission_id: '4', 
      resource: 'project', 
      action: 'delete',
      tenant: 'test-tenant',
      msp: true,
      client: false
    };

    // Create roles with project permissions
    userRole = {
      role_id: '1',
      role_name: 'User',
      description: 'Regular user role with view project permission',
      permissions: [viewProjectPermission],
      tenant: 'test-tenant',
      msp: true,
      client: false
    };

    adminRole = {
      role_id: '2',
      role_name: 'Admin',
      description: 'Administrator role with all project permissions',
      permissions: [viewProjectPermission, editProjectPermission, createProjectPermission, deleteProjectPermission],
      tenant: 'test-tenant',
      msp: true,
      client: false
    };

    // Create users with specific roles
    regularUser = {
      user_id: '1',
      tenant: 'test-tenant',
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
      user_id: '2',
      tenant: 'test-tenant',
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
      user_id: '3',
      tenant: 'test-tenant',
      username: 'nopermissions',
      first_name: 'No',
      last_name: 'Permissions',
      email: 'no@permissions.com',
      hashed_password: 'hashed_password_here',
      is_inactive: false,
      user_type: 'user',
      roles: [] // Empty roles array
    };

    mockProject = {
      tenant: 'test-tenant',
      project_id: 'P-1',
      client_id: 'COMP-1',
      project_name: 'Test Project',
      description: 'This is a test project',
      start_date: new Date(),
      end_date: null,
      status: 'STATUS-1',
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
    const project = await projectActions.getProject('P-1');
    expect(project).toEqual(mockProject);
  });

  it('should allow admin user to view a specific project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    const project = await projectActions.getProject('P-1');
    expect(project).toEqual(mockProject);
  });

  it('should throw an error if user does not have view permission for a specific project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(userWithoutPermissions);
    await expect(projectActions.getProject('P-1')).rejects.toThrow('Permission denied: Cannot read project');
  });

  const updateData: Partial<IProject> = {
    project_name: 'Updated Project Name',
    updated_at: new Date()
  };

  it('should allow admin user to edit a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    const result = await projectActions.updateProject('P-1', updateData);
    expect(result).toEqual(mockProject);
  });

  it('should not allow regular user to edit a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(regularUser);
    await expect(projectActions.updateProject('P-1', updateData)).rejects.toThrow('Permission denied: Cannot update project');
  });

  it('should throw an error if user does not have edit permission', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(userWithoutPermissions);
    await expect(projectActions.updateProject('P-1', updateData)).rejects.toThrow('Permission denied: Cannot update project');
  });

  const newProjectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at'> = {
    tenant: 'test-tenant',
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
    vi.mocked(getCurrentUser).mockResolvedValue(userWithoutPermissions);
    await expect(projectActions.createProject(newProjectData)).rejects.toThrow('Permission denied: Cannot create project');
  });

  it('should allow admin user to delete a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    await expect(projectActions.deleteProject('P-1')).resolves.toBeUndefined();
  });

  it('should not allow regular user to delete a project', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(regularUser);
    await expect(projectActions.deleteProject('P-1')).rejects.toThrow('Permission denied: Cannot delete project');
  });

  it('should throw an error if user does not have delete permission', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(userWithoutPermissions);
    await expect(projectActions.deleteProject('P-1')).rejects.toThrow('Permission denied: Cannot delete project');
  });
});
