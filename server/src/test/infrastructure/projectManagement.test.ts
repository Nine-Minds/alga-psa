// server/src/test/infrastructure/projectManagement.test.ts
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knex from 'knex';
import dotenv from 'dotenv';
import { TextEncoder } from 'util';
import {
    createProject,
    addProjectPhase,
    addTaskToPhase,
    updateProject,
    updatePhase,
    updateTaskWithChecklist,
    moveTaskToPhase,
    deleteTask,
    deletePhase,
    deleteProject
} from '../../lib/actions/projectActions';
import { IProject, IProjectPhase, IProjectTask } from '../../interfaces/project.interfaces';
import ProjectModel from '../../lib/models/project';

global.TextEncoder = TextEncoder;

// Mock getCurrentUser
vi.mock('../../lib/actions/user-actions/userActions', () => ({
    getCurrentUser: vi.fn(() => Promise.resolve({
        id: 'mock-user-id',
        tenant: '11111111-1111-1111-1111-111111111111',
        email: 'test@example.com',
        name: 'Test User'
    }))
}));

// Mock hasPermission
vi.mock('../../lib/auth/rbac', () => ({
    hasPermission: vi.fn(() => Promise.resolve(true))
}));

// Mock next/headers
const mockHeaders = {
    get: vi.fn((key: string) => {
        if (key === 'x-tenant-id') {
            return '11111111-1111-1111-1111-111111111111';
        }
        return null;
    }),
    append: vi.fn(),
    delete: vi.fn(),
    entries: vi.fn(),
    forEach: vi.fn(),
    has: vi.fn(),
    keys: vi.fn(),
    set: vi.fn(),
    values: vi.fn(),
};

vi.mock('next/headers', () => ({
    headers: vi.fn(() => mockHeaders)
}));

// Mock next-auth with tenant information
vi.mock("next-auth/next", () => ({
    getServerSession: vi.fn(() => Promise.resolve({
        user: {
            id: 'mock-user-id',
            tenant: '11111111-1111-1111-1111-111111111111',
            email: 'test@example.com',
            name: 'Test User'
        }
    })),
}));

// Mock ProjectModel
vi.mock('../../lib/models/project', () => {
    const taskStore = new Map();
    
    return {
        default: {
            getAll: vi.fn(),
            getById: vi.fn(),
            create: vi.fn((data) => ({
                ...data,
                project_id: uuidv4(),
                created_at: new Date(),
                updated_at: new Date()
            })),
            update: vi.fn((id, data) => ({
                project_id: id,
                ...data,
                updated_at: new Date()
            })),
            delete: vi.fn(),
            getPhases: vi.fn(() => []),
            getPhaseById: vi.fn((id) => ({
                phase_id: id,
                project_id: 'test-project-id',
                phase_name: 'Test Phase',
                wbs_code: '1.1'
            })),
            addPhase: vi.fn((data) => ({
                ...data,
                phase_id: uuidv4(),
                created_at: new Date(),
                updated_at: new Date()
            })),
            updatePhase: vi.fn((id, data) => ({
                phase_id: id,
                ...data,
                updated_at: new Date()
            })),
            deletePhase: vi.fn(),
            getTasks: vi.fn(() => []),
            getTaskById: vi.fn((id) => {
                return taskStore.get(id) || null;
            }),
            addTask: vi.fn((phaseId, data) => {
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
            updateTask: vi.fn((id, data) => {
                const task = {
                    task_id: id,
                    ...data,
                    updated_at: new Date()
                };
                taskStore.set(id, task);
                return task;
            }),
            deleteTask: vi.fn((id) => {
                taskStore.delete(id);
            }),
            getProjectStatusMappings: vi.fn((projectId) => {
                return [{
                    project_status_mapping_id: 'test-status-mapping-id',
                    project_id: projectId,
                    standard_status_id: 'test-standard-status-id',
                    is_standard: true,
                    custom_name: null,
                    display_order: 1,
                    is_visible: true
                }];
            }),
            getProjectStatusMapping: vi.fn((id) => ({
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
            generateNextWbsCode: vi.fn((parentWbsCode) => {
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

let db: knex.Knex;

// Ensure we're using a test database
if (process.env.DB_NAME_SERVER === 'server') {
    throw new Error('Please use a test database for testing.');
}

beforeAll(async () => {
    dotenv.config();
    db = knex({
        client: 'pg',
        connection: {
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER_SERVER,
            password: process.env.DB_PASSWORD_SERVER,
            database: process.env.DB_NAME_SERVER
        },
        migrations: {
            directory: "./migrations"
        },
        seeds: {
            directory: "./seeds/dev"
        }
    });

    // Initial database setup
    await db.raw('DROP SCHEMA public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.raw(`SET app.environment = '${process.env.APP_ENV}'`);
    await db.migrate.latest();
    
    // Run seeds and verify they completed
    await db.seed.run();
    const standardStatuses = await db('standard_statuses').select('*');
    if (standardStatuses.length === 0) {
        throw new Error('Standard statuses seed failed - database is not properly initialized');
    }
});

afterAll(async () => {
    await db.destroy();
});

afterEach(async () => {
    // Reset the database to a clean state between tests
    await db.raw('DROP SCHEMA public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.raw(`SET app.environment = '${process.env.APP_ENV}'`);
    await db.migrate.latest();
    
    // Run seeds and verify they completed
    await db.seed.run();
    const standardStatuses = await db('standard_statuses').select('*');
    if (standardStatuses.length === 0) {
        throw new Error('Standard statuses seed failed - database is not properly initialized');
    }

    // Clear all mocks
    vi.clearAllMocks();
});

async function getNextWbsCode(db: knex.Knex, tenantId: string): Promise<string> {
    const maxProject = await db('projects')
        .where({ tenant: tenantId })
        .max('wbs_code as max')
        .first();
    
    const currentMax = maxProject?.max ? parseInt(maxProject.max) : 0;
    return (currentMax + 1).toString();
}

async function getNextPhaseWbsCode(db: knex.Knex, projectWbsCode: string): Promise<string> {
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
    let tenantId: string;
    let companyId: string;
    let initialStatusId: string;

    beforeEach(async () => {
        // Get tenant ID
        ({ tenant: tenantId } = await db('tenants').select("tenant").first());

        // Create a test company
        companyId = uuidv4();
        await db('companies').insert({
            company_id: companyId,
            company_name: 'Test Company',
            tenant: tenantId,
        });

        // Get initial status ID
        const status = await db('statuses')
            .where({ tenant: tenantId, status_type: 'project' })
            .first();
        initialStatusId = status.status_id;
    });

    describe('Project Creation and Management', () => {
        it('should create a new project with initial status', async () => {
            const wbsCode = await getNextWbsCode(db, tenantId);
            const projectData = {
                company_id: companyId,
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
                company_id: companyId,
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
            // First create a project
            const project = await createProject({
                company_id: companyId,
                project_name: 'Initial Project',
                description: 'Initial Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: wbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            });

            // Update the project
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
            const project = await createProject({
                company_id: companyId,
                project_name: 'Test Project',
                description: 'Test Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: projectWbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            });
            projectId = project.project_id;
        });

        it('should create a new phase in a project', async () => {
            const phaseWbsCode = await getNextPhaseWbsCode(db, projectWbsCode);
            const phaseData = {
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
            // First create a phase
            const phase = await addProjectPhase({
                project_id: projectId,
                phase_name: 'Initial Phase',
                description: 'Initial Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: phaseWbsCode,
                order_number: 1
            });

            // Update the phase
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
            const project = await createProject({
                company_id: companyId,
                project_name: 'Test Project',
                description: 'Test Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: projectWbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            });
            projectId = project.project_id;

            // Create phase
            phaseWbsCode = await getNextPhaseWbsCode(db, projectWbsCode);
            const phase = await addProjectPhase({
                project_id: projectId,
                phase_name: 'Test Phase',
                description: 'Test Phase Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: phaseWbsCode,
                order_number: 1
            });
            phaseId = phase.phase_id;

            // Get status mapping
            const statusMappings = await ProjectModel.getProjectStatusMappings(projectId);
            statusMappingId = statusMappings[0].project_status_mapping_id;
        });

        it('should create a new task in a phase', async () => {
            const taskWbsCode = `${phaseWbsCode}.1`;
            const taskData = {
                task_name: 'Test Task',
                description: 'Test Task Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode
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
            // First create a task
            const task = await addTaskToPhase(phaseId, {
                task_name: 'Initial Task',
                description: 'Initial Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode
            }, []);

            if (!task) throw new Error('Task creation failed');

            // Update the task
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
            const newPhase = await addProjectPhase({
                project_id: projectId,
                phase_name: 'New Phase',
                description: 'New Phase Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: newPhaseWbsCode,
                order_number: 2
            });

            // Create a task
            const taskWbsCode = `${phaseWbsCode}.1`;
            const task = await addTaskToPhase(phaseId, {
                task_name: 'Test Task',
                description: 'Test Task Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode
            }, []);

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
            const newProject = await createProject({
                company_id: companyId,
                project_name: 'New Project',
                description: 'New Project Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: newProjectWbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            });

            // Create phase in new project
            const newPhaseWbsCode = await getNextPhaseWbsCode(db, newProjectWbsCode);
            const newPhase = await addProjectPhase({
                project_id: newProject.project_id,
                phase_name: 'New Phase',
                description: 'New Phase Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: newPhaseWbsCode,
                order_number: 1
            });

            // Get status mapping for new project
            const newStatusMappings = await ProjectModel.getProjectStatusMappings(newProject.project_id);
            const newStatusMappingId = newStatusMappings[0].project_status_mapping_id;

            // Create a task
            const taskWbsCode = `${phaseWbsCode}.1`;
            const task = await addTaskToPhase(phaseId, {
                task_name: 'Test Task',
                description: 'Test Task Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode
            }, []);

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
            const project = await createProject({
                company_id: companyId,
                project_name: 'Test Project',
                description: 'Test Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                wbs_code: projectWbsCode,
                is_inactive: false,
                tenant: tenantId,
                status: initialStatusId
            });
            projectId = project.project_id;

            // Create phase
            phaseWbsCode = await getNextPhaseWbsCode(db, projectWbsCode);
            const phase = await addProjectPhase({
                project_id: projectId,
                phase_name: 'Test Phase',
                description: 'Test Phase Description',
                start_date: new Date(),
                end_date: new Date(Date.now() + 86400000),
                status: 'active',
                wbs_code: phaseWbsCode,
                order_number: 1
            });
            phaseId = phase.phase_id;

            // Get status mapping
            const statusMappings = await ProjectModel.getProjectStatusMappings(projectId);
            const statusMappingId = statusMappings[0].project_status_mapping_id;

            // Create task
            const taskWbsCode = `${phaseWbsCode}.1`;
            const task = await addTaskToPhase(phaseId, {
                task_name: 'Test Task',
                description: 'Test Task Description',
                estimated_hours: 8,
                actual_hours: 0,
                assigned_to: null,
                due_date: null,
                project_status_mapping_id: statusMappingId,
                wbs_code: taskWbsCode
            }, []);

            if (!task) throw new Error('Task creation failed');
            taskId = task.task_id;
        });

        it('should delete a task', async () => {
            await deleteTask(taskId);
            expect(ProjectModel.deleteTask).toHaveBeenCalledWith(taskId);
        });

        it('should delete a phase', async () => {
            await deletePhase(phaseId);
            expect(ProjectModel.deletePhase).toHaveBeenCalledWith(phaseId);
        });

        it('should delete a project', async () => {
            await deleteProject(projectId);
            expect(ProjectModel.delete).toHaveBeenCalledWith(projectId);
        });
    })})