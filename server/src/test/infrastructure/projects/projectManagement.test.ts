import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { Knex } from 'knex';
import { TestContext } from '../../../../test-utils/testContext';
import {
    setupCommonMocks,
    mockNextHeaders,
    mockNextAuth,
    mockRBAC,
    mockGetCurrentUser,
    createMockUser
} from '../../../../test-utils/testMocks';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestEnvironment, createClient } from '../../../../test-utils/testDataFactory';
import { resetDatabase, cleanupTables, createCleanupHook } from '../../../../test-utils/dbReset';
import {
    createProject,
    addProjectPhase,
    updateProject,
    updatePhase,
    deletePhase,
    deleteProject
} from 'server/src/lib/actions/project-actions/projectActions';
import {
    addTaskToPhase,
    updateTaskWithChecklist,
    moveTaskToPhase,
    deleteTask
} from 'server/src/lib/actions/project-actions/projectTaskActions';
import { IProject, IProjectPhase, IProjectTask } from 'server/src/interfaces/project.interfaces';
import ProjectModel from 'server/src/lib/models/project';
import ProjectTaskModel from 'server/src/lib/models/projectTask';

global.TextEncoder = TextEncoder;

// Type definitions for create operations
type CreateProjectInput = Omit<IProject, 'project_id' | 'created_at' | 'updated_at'>;
type CreatePhaseInput = Omit<IProjectPhase, 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>;
type CreateTaskInput = Omit<IProjectTask, 'task_id' | 'created_at' | 'updated_at' | 'tenant' | 'phase_id'>;

// Mock ProjectModel
vi.mock('@/lib/models/project', () => {
    const taskStore = new Map();
    
    return {
        default: {
            getAll: vi.fn(),
            getById: vi.fn(),
            create: vi.fn((data: any) => ({
                ...data,
                project_id: uuidv4(),
                created_at: new Date(),
                updated_at: new Date()
            })),
            update: vi.fn((id: string, data: any) => ({
                project_id: id,
                ...data,
                updated_at: new Date()
            })),
            delete: vi.fn(),
            getPhases: vi.fn(() => []),
            getPhaseById: vi.fn((id: string) => ({
                phase_id: id,
                project_id: 'test-project-id',
                phase_name: 'Test Phase',
                wbs_code: '1.1'
            })),
            addPhase: vi.fn((data: any) => ({
                ...data,
                phase_id: uuidv4(),
                created_at: new Date(),
                updated_at: new Date()
            })),
            updatePhase: vi.fn((id: string, data: any) => ({
                phase_id: id,
                ...data,
                updated_at: new Date()
            })),
            deletePhase: vi.fn(),
            getTasks: vi.fn(() => []),
            getTaskById: vi.fn((id: string) => taskStore.get(id) || null),
            addTask: vi.fn((phaseId: string, data: any) => {
                const task = {
                    task_id: uuidv4(),
                    phase_id: phaseId,
                    task_name: data.task_name,
                    description: data.description,
                    estimated_hours: data.estimated_hours,
                    actual_hours: data.actual_hours || 0,
                    assigned_to: data.assigned_to,
                    due_date: data.due_date,
                    project_status_mapping_id: data.project_status_mapping_id,
                    wbs_code: data.wbs_code,
                    created_at: new Date(),
                    updated_at: new Date(),
                    checklist_items: []
                };
                taskStore.set(task.task_id, task);
                return task;
            }),
            updateTask: vi.fn((id: string, data: any) => {
                const task = {
                    task_id: id,
                    ...data,
                    updated_at: new Date()
                };
                taskStore.set(id, task);
                return task;
            }),
            deleteTask: vi.fn((id: string) => {
                taskStore.delete(id);
            }),
            getProjectStatusMappings: vi.fn((projectId: string) => [{
                project_status_mapping_id: 'test-status-mapping-id',
                project_id: projectId,
                standard_status_id: 'test-standard-status-id',
                is_standard: true,
                custom_name: null,
                display_order: 1,
                is_visible: true
            }]),
            getProjectStatusMapping: vi.fn((id: string) => ({
                project_status_mapping_id: id,
                project_id: 'test-project-id',
                standard_status_id: 'test-standard-status-id',
                is_standard: true,
                custom_name: null,
                display_order: 1,
                is_visible: true
            })),
            addProjectStatusMapping: vi.fn(),
            getStandardStatusesByType: vi.fn(() => [
                {
                    standard_status_id: uuidv4(),
                    name: 'To Do',
                    item_type: 'project_task',
                    display_order: 1,
                    is_closed: false
                },
                {
                    standard_status_id: uuidv4(),
                    name: 'In Progress',
                    item_type: 'project_task',
                    display_order: 2,
                    is_closed: false
                },
                {
                    standard_status_id: uuidv4(),
                    name: 'Done',
                    item_type: 'project_task',
                    display_order: 3,
                    is_closed: true
                }
            ]),
            getCustomStatus: vi.fn(),
            getStandardStatus: vi.fn(),
            getStatusesByType: vi.fn(() => [
                {
                    status_id: uuidv4(),
                    name: 'Active',
                    status_type: 'project',
                    is_closed: false,
                    order_number: 1
                },
                {
                    status_id: uuidv4(),
                    name: 'Completed',
                    status_type: 'project',
                    is_closed: true,
                    order_number: 2
                }
            ]),
            generateNextWbsCode: vi.fn((parentWbsCode: string) => {
                const parts = parentWbsCode.split('.');
                const lastPart = parseInt(parts[parts.length - 1]);
                parts[parts.length - 1] = (lastPart + 1).toString();
                return Promise.resolve(parts.join('.'));
            }),
            getTaskTicketLinks: vi.fn(() => []),
            updateTaskTicketLink: vi.fn(),
            deleteTaskTicketLink: vi.fn(),
            addTaskTicketLink: vi.fn(),
            getChecklistItems: vi.fn(() => []),
            addChecklistItem: vi.fn(),
            updateChecklistItem: vi.fn(),
            deleteChecklistItems: vi.fn(),
            deleteChecklistItem: vi.fn(),
        }
    };
});

async function getNextWbsCode(db: Knex, tenantId: string): Promise<string> {
    const maxProject = await db('projects')
        .where({ tenant: tenantId })
        .max('wbs_code as max')
        .first();
    
    const currentMax = maxProject?.max ? parseInt(maxProject.max) : 0;
    return (currentMax + 1).toString();
}

async function getNextPhaseWbsCode(db: Knex, projectWbsCode: string): Promise<string> {
    const maxPhase = await db('project_phases')
        .where('wbs_code', 'like', `${projectWbsCode}.%`)
        .max('wbs_code as max')
        .first();
    
    if (!maxPhase?.max) {
        return `${projectWbsCode}.1`;
    }

    const currentMax = parseInt(maxPhase.max.split('.').pop() || '0');
    return `${projectWbsCode}.${currentMax + 1}`;
}

describe('Project Management', () => {
    let db: Knex;
    let tenantId: string;
    let clientId: string;
    let initialStatusId: string;

    beforeAll(async () => {
        // Initialize database with tenant context
        db = await createTestDbConnection();
        await resetDatabase(db);
    });

    afterAll(async () => {
        await db.destroy();
    });

    beforeEach(async () => {
        await resetDatabase(db);
        
        // Set up common mocks
        const { tenantId: mockTenantId } = setupCommonMocks({
            user: createMockUser('admin')
        });
        tenantId = mockTenantId;

        // Create test client
        clientId = await createClient(db, tenantId, 'Test Client');

        // Get initial status ID
        const status = await db('statuses')
            .where({ tenant: tenantId, status_type: 'project' })
            .first();
        initialStatusId = status.status_id;
    });

    describe('Project Creation and Management', () => {
        it('should create a new project with initial status', async () => {
            const wbsCode = await getNextWbsCode(db, tenantId);
            const projectData: CreateProjectInput = {
                client_id: clientId,
                project_name: 'Test Project',
                description: 'Test Project Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000), // tomorrow
                wbs_code: wbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            };

            const result = await createProject(projectData);

            expect(result).toMatchObject({
                client_id: clientId,
                project_name: 'Test Project',
                description: 'Test Project Description',
                is_inactive: false,
            });

            expect(result.project_id).toBeDefined();
            expect(result.status).toBeDefined();
            expect(result.created_at).toBeInstanceOf(Date);
            expect(result.updated_at).toBeInstanceOf(Date);
        });

        it('should update project details', async () => {
            const wbsCode = await getNextWbsCode(db, tenantId);
            const projectData: CreateProjectInput = {
                client_id: clientId,
                project_name: 'Initial Project',
                description: 'Initial Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: wbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            };

            const project = await createProject(projectData);

            const updateData = {
                project_name: 'Updated Project',
                description: 'Updated Description',
                is_inactive: true
            };

            const updatedProject = await updateProject(project.project_id, updateData);

            expect(updatedProject).toMatchObject({
                project_id: project.project_id,
                project_name: 'Updated Project',
                description: 'Updated Description',
                is_inactive: true
            });
        });
    });

    describe('Phase Management', () => {
        let projectId: string;
        let projectWbsCode: string;

        beforeEach(async () => {
            projectWbsCode = await getNextWbsCode(db, tenantId);
            const projectData: CreateProjectInput = {
                client_id: clientId,
                project_name: 'Test Project',
                description: 'Test Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: projectWbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            };
            const project = await createProject(projectData);
            projectId = project.project_id;
        });

        it('should create a new phase in a project', async () => {
            const phaseWbsCode = await getNextPhaseWbsCode(db, projectWbsCode);
            const phaseData: CreatePhaseInput = {
                project_id: projectId,
                phase_name: 'Test Phase',
                description: 'Test Phase Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: phaseWbsCode,
                order_number: 1
            };

            const result = await addProjectPhase(phaseData);

            expect(result).toMatchObject({
                project_id: projectId,
                phase_name: 'Test Phase',
                description: 'Test Phase Description',
                status: 'active'
            });

            expect(result.phase_id).toBeDefined();
            expect(result.created_at).toBeInstanceOf(Date);
            expect(result.updated_at).toBeInstanceOf(Date);
        });

        it('should update phase details', async () => {
            const phaseWbsCode = await getNextPhaseWbsCode(db, projectWbsCode);
            const phaseData: CreatePhaseInput = {
                project_id: projectId,
                phase_name: 'Initial Phase',
                description: 'Initial Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: phaseWbsCode,
                order_number: 1
            };

            const phase = await addProjectPhase(phaseData);

            const updateData = {
                phase_name: 'Updated Phase',
                description: 'Updated Description',
                status: 'completed'
            };

            const updatedPhase = await updatePhase(phase.phase_id, updateData);

            expect(updatedPhase).toMatchObject({
                phase_id: phase.phase_id,
                phase_name: 'Updated Phase',
                description: 'Updated Description',
                status: 'completed'
            });
        });
    });

    describe('Task Management', () => {
        let projectId: string;
        let projectWbsCode: string;
        let phaseId: string;
        let phaseWbsCode: string;
        let statusMappingId: string;

        beforeEach(async () => {
            // Create project
            projectWbsCode = await getNextWbsCode(db, tenantId);
            const projectData: CreateProjectInput = {
                client_id: clientId,
                project_name: 'Test Project',
                description: 'Test Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: projectWbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            };
            const project = await createProject(projectData);
            projectId = project.project_id;

            // Create phase
            phaseWbsCode = await getNextPhaseWbsCode(db, projectWbsCode);
            const phaseData: CreatePhaseInput = {
                project_id: projectId,
                phase_name: 'Test Phase',
                description: 'Test Phase Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: phaseWbsCode,
                order_number: 1
            };
            const phase = await addProjectPhase(phaseData);
            phaseId = phase.phase_id;

            // Get status mapping
            const statusMappings = await ProjectModel.getProjectStatusMappings(db, projectId);
            statusMappingId = statusMappings[0].project_status_mapping_id;
        });

        it('should create a new task in a phase', async () => {
            const taskWbsCode = `${phaseWbsCode}.1`;
            const taskData: CreateTaskInput = {
                task_name: 'Test Task',
                description: 'Test Task Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode,
                task_type_key: 'standard'
            };

            const result = await addTaskToPhase(phaseId, taskData, []);

            expect(result).toMatchObject({
                task_name: 'Test Task',
                description: 'Test Task Description',
                estimated_hours: 8,
                project_status_mapping_id: statusMappingId
            });

            expect(result?.task_id).toBeDefined();
            expect(result?.created_at).toBeInstanceOf(Date);
            expect(result?.updated_at).toBeInstanceOf(Date);
        });

        it('should update task details', async () => {
            const taskWbsCode = `${phaseWbsCode}.1`;
            const taskData: CreateTaskInput = {
                task_name: 'Initial Task',
                description: 'Initial Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode,
                task_type_key: 'standard'
            };

            const task = await addTaskToPhase(phaseId, taskData, []);

            if (!task) throw new Error('Task creation failed');

            const updateData = {
                task_name: 'Updated Task',
                description: 'Updated Description',
                estimated_hours: 16
            };

            const updatedTask = await updateTaskWithChecklist(task.task_id, updateData);

            expect(updatedTask).toMatchObject({
                task_id: task.task_id,
                task_name: 'Updated Task',
                description: 'Updated Description',
                estimated_hours: 16
            });
        });

        it('should move task to a different phase', async () => {
            // Create another phase
            const newPhaseWbsCode = await getNextPhaseWbsCode(db, projectWbsCode);
            const newPhaseData: CreatePhaseInput = {
                project_id: projectId,
                phase_name: 'New Phase',
                description: 'New Phase Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: newPhaseWbsCode,
                order_number: 2
            };
            const newPhase = await addProjectPhase(newPhaseData);

            // Create a task
            const taskWbsCode = `${phaseWbsCode}.1`;
            const taskData: CreateTaskInput = {
                task_name: 'Test Task',
                description: 'Test Task Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode,
                task_type_key: 'standard'
            };

            const task = await addTaskToPhase(phaseId, taskData, []);

            if (!task) throw new Error('Task creation failed');

            // Mock the expected new WBS code
            const expectedNewWbsCode = `${newPhaseWbsCode}.1`;
            vi.mocked(ProjectModel.generateNextWbsCode).mockResolvedValueOnce(expectedNewWbsCode);

            // Move the task
            const movedTask = await moveTaskToPhase(task.task_id, newPhase.phase_id);

            expect(movedTask).toMatchObject({
                task_id: task.task_id,
                phase_id: newPhase.phase_id,
                task_name: 'Test Task',
                wbs_code: expectedNewWbsCode
            });
        });

        it('should move task to a different project', async () => {
            // Create another project
            const newProjectWbsCode = await getNextWbsCode(db, tenantId);
            const newProjectData: CreateProjectInput = {
                client_id: clientId,
                project_name: 'New Project',
                description: 'New Project Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: newProjectWbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            };
            const newProject = await createProject(newProjectData);

            // Create phase in new project
            const newPhaseWbsCode = await getNextPhaseWbsCode(db, newProjectWbsCode);
            const newPhaseData: CreatePhaseInput = {
                project_id: newProject.project_id,
                phase_name: 'New Phase',
                description: 'New Phase Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: newPhaseWbsCode,
                order_number: 1
            };
            const newPhase = await addProjectPhase(newPhaseData);

            // Get status mapping for new project
            const newStatusMappings = await ProjectModel.getProjectStatusMappings(db, newProject.project_id);
            const newStatusMappingId = newStatusMappings[0].project_status_mapping_id;

            // Create a task
            const taskWbsCode = `${phaseWbsCode}.1`;
            const taskData: CreateTaskInput = {
                task_name: 'Test Task',
                description: 'Test Task Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode,
                task_type_key: 'standard'
            };

            const task = await addTaskToPhase(phaseId, taskData, []);

            if (!task) throw new Error('Task creation failed');

            // Mock the expected new WBS code
            const expectedNewWbsCode = `${newPhaseWbsCode}.1`;
            vi.mocked(ProjectModel.generateNextWbsCode).mockResolvedValueOnce(expectedNewWbsCode);

            // Move the task
            const movedTask = await moveTaskToPhase(task.task_id, newPhase.phase_id, newStatusMappingId);

            expect(movedTask).toMatchObject({
                task_id: task.task_id,
                phase_id: newPhase.phase_id,
                task_name: 'Test Task',
                project_status_mapping_id: newStatusMappingId,
                wbs_code: expectedNewWbsCode
            });
        });
    });

    describe('Deletion Operations', () => {
        let projectId: string;
        let projectWbsCode: string;
        let phaseId: string;
        let phaseWbsCode: string;
        let taskId: string;

        beforeEach(async () => {
            // Create project
            projectWbsCode = await getNextWbsCode(db, tenantId);
            const projectData: CreateProjectInput = {
                client_id: clientId,
                project_name: 'Test Project',
                description: 'Test Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: projectWbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            };
            const project = await createProject(projectData);
            projectId = project.project_id;

            // Create phase
            phaseWbsCode = await getNextPhaseWbsCode(db, projectWbsCode);
            const phaseData: CreatePhaseInput = {
                project_id: projectId,
                phase_name: 'Test Phase',
                description: 'Test Phase Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: phaseWbsCode,
                order_number: 1
            };
            const phase = await addProjectPhase(phaseData);
            phaseId = phase.phase_id;

            // Get status mapping
            const statusMappings = await ProjectModel.getProjectStatusMappings(db, projectId);
            const statusMappingId = statusMappings[0].project_status_mapping_id;

            // Create task
            const taskWbsCode = `${phaseWbsCode}.1`;
            const taskData: CreateTaskInput = {
                task_name: 'Test Task',
                description: 'Test Task Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode,
                task_type_key: 'standard'
            };

            const task = await addTaskToPhase(phaseId, taskData, []);

            if (!task) throw new Error('Task creation failed');
            taskId = task.task_id;
        });

        it('should delete a task', async () => {
            await deleteTask(taskId);
            expect(ProjectTaskModel.deleteTask).toHaveBeenCalledWith(taskId);
        });

        it('should delete a phase', async () => {
            await deletePhase(phaseId);
            expect(ProjectModel.deletePhase).toHaveBeenCalledWith(phaseId);
        });

        it('should delete a project', async () => {
            await deleteProject(projectId);
            expect(ProjectModel.delete).toHaveBeenCalledWith(projectId);
        });
    });
});