import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { Knex } from 'knex';
import {
    setupCommonMocks,
    createMockUser
} from '../../../../test-utils/testMocks';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createClient } from '../../../../test-utils/testDataFactory';
import { cleanupTables } from '../../../../test-utils/dbReset';
import {
    createProject,
    addProjectPhase,
    updateProject,
    updatePhase,
    deletePhase,
    deleteProject
} from '@alga-psa/projects/actions/projectActions';
import {
    addTaskToPhase,
    updateTaskWithChecklist,
    moveTaskToPhase,
    deleteTask
} from '@alga-psa/projects/actions/projectTaskActions';
import type { IProject, IProjectPhase, IProjectTask } from '@alga-psa/types';
import { ProjectModel } from '@alga-psa/projects/models';

global.TextEncoder = TextEncoder;

// The project and task models are NOT mocked here. This file lives in
// src/test/infrastructure, so its job is to exercise the real database path:
// the actions insert and then reload through the models, and stubbed models
// made every action fail with "Created project could not be reloaded after
// insert" while proving nothing about the schema.
//
// The actions are withAuth-wrapped, so the acting user comes from the session.
// Mocking the auth module lets setupCommonMocks drive that user (and its
// tenant) instead of the real session/DB lookup.
vi.mock('@alga-psa/auth', async () => {
    const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
    return createAuthModuleMock();
});

// Type definitions for create operations
type CreateProjectInput = Omit<IProject, 'project_id' | 'created_at' | 'updated_at'>;
type CreatePhaseInput = Omit<IProjectPhase, 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>;
type CreateTaskInput = Omit<IProjectTask, 'task_id' | 'created_at' | 'updated_at' | 'tenant' | 'phase_id'>;

describe('Project Management', () => {
    let db: Knex;
    let tenantId: string;
    let userId: string;
    let clientId: string;
    let initialStatusId: string;

    beforeAll(async () => {
        // createTestDbConnection already drops, recreates, migrates and seeds
        // the suite database. The resetDatabase() that used to follow it
        // destroys the handle it is given, so every query in this file failed
        // with "Unable to acquire a connection".
        db = await createTestDbConnection();
        const seededTenant = await db('tenants').first('tenant');
        if (!seededTenant?.tenant) {
            throw new Error('Seeded tenant missing from test database');
        }
        tenantId = seededTenant.tenant;

        // The acting user must be a real row: the authorization kernel narrows
        // on team_members.user_id, and the default mock id ('mock-user-id') is
        // not a uuid — that query errored and aborted the action's transaction,
        // so the next statement failed with "current transaction is aborted".
        const seededUser = await db('users').where({ tenant: tenantId }).first('user_id');
        if (!seededUser?.user_id) {
            throw new Error('Seeded user missing from test database');
        }
        userId = seededUser.user_id;
    });

    afterAll(async () => {
        await db.destroy();
    });

    beforeEach(async () => {
        // Per-test isolation without rebuilding the schema: drop the rows this
        // suite creates. The full drop/migrate/seed cycle used to run here,
        // costing ~90s per test on top of taking the connection with it.
        await cleanupTables(
            db,
            ['projects', 'project_phases', 'project_tasks', 'task_checklist_items', 'project_ticket_links'],
            { ignoreErrors: true }
        );

        // Mocks must speak for the seeded tenant — the default mock tenant id
        // has no rows in this database.
        setupCommonMocks({
            tenantId,
            userId,
            // createMockUser leaves roles empty, and the default RBAC mock reads
            // them, so the admin fixture was denied everything.
            user: createMockUser('internal', {
                user_id: userId,
                tenant: tenantId,
                roles: [{ role_id: 'mock-admin-role', role_name: 'Admin', description: 'Admin', tenant: tenantId }]
            })
        });

        // Create test client
        // clients_tenant_client_name_unique: the database is no longer rebuilt
        // between tests, so each one needs its own name.
        clientId = await createClient(db, tenantId, `Test Client ${uuidv4().slice(0, 8)}`);

        // Get initial status ID
        const status = await db('statuses')
            .where({ tenant: tenantId, status_type: 'project' })
            .first();
        initialStatusId = status.status_id;
    });

    // wbs_code and project_number are generated by the action, so fixtures only
    // supply the fields a caller would.
    function projectInput(overrides: Partial<CreateProjectInput> = {}): CreateProjectInput {
        return {
            client_id: clientId,
            project_name: 'Test Project',
            description: 'Test Project Description',
            start_date: new Date(),
            end_date: new Date(Date.now() + 86400000), // tomorrow
            is_inactive: false,
            tenant: tenantId,
            status: initialStatusId,
            ...overrides
        } as CreateProjectInput;
    }

    // addProjectPhase validates against the full phase schema, so wbs_code has
    // to be present even though the action immediately replaces it with one
    // derived from the project's own code.
    function phaseInput(projectId: string, overrides: Partial<CreatePhaseInput> = {}): CreatePhaseInput {
        return {
            project_id: projectId,
            phase_name: 'Test Phase',
            description: 'Test Phase Description',
            start_date: new Date(),
            end_date: new Date(Date.now() + 86400000),
            status: 'active',
            wbs_code: 'generated-by-action',
            order_number: 1,
            ...overrides
        } as CreatePhaseInput;
    }

    function taskInput(statusMappingId: string, overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
        return {
            task_name: 'Test Task',
            description: 'Test Task Description',
            estimated_hours: 8,
            actual_hours: 0,
            assigned_to: null,
            due_date: null,
            project_status_mapping_id: statusMappingId,
            task_type_key: 'standard',
            ...overrides
        } as CreateTaskInput;
    }

    async function firstStatusMappingId(projectId: string): Promise<string> {
        const mappings = await ProjectModel.getProjectStatusMappings(db, tenantId, projectId);
        return mappings[0].project_status_mapping_id;
    }

    describe('Project Creation and Management', () => {
        it('should create a new project with initial status', async () => {
            const result = await createProject(projectInput());

            expect(result).toMatchObject({
                client_id: clientId,
                project_name: 'Test Project',
                description: 'Test Project Description',
                is_inactive: false,
            });

            expect(result.project_id).toBeDefined();
            expect(result.status).toBeDefined();
            // Generated rather than supplied by the caller.
            expect(result.wbs_code).toBeTruthy();
            expect(result.project_number).toBeTruthy();

            const persisted = await db('projects')
                .where({ project_id: result.project_id, tenant: tenantId })
                .first();
            expect(persisted).toBeDefined();
            expect(persisted.project_name).toBe('Test Project');
        });

        it('should update project details', async () => {
            const project = await createProject(projectInput({ project_name: 'Initial Project', description: 'Initial Description' }));

            const updatedProject = await updateProject(project.project_id, {
                project_name: 'Updated Project',
                description: 'Updated Description',
                is_inactive: true
            });

            expect(updatedProject).toMatchObject({
                project_id: project.project_id,
                project_name: 'Updated Project',
                description: 'Updated Description',
                is_inactive: true
            });

            const persisted = await db('projects')
                .where({ project_id: project.project_id, tenant: tenantId })
                .first();
            expect(persisted.project_name).toBe('Updated Project');
            expect(persisted.is_inactive).toBe(true);
        });
    });

    describe('Phase Management', () => {
        let projectId: string;

        beforeEach(async () => {
            const project = await createProject(projectInput());
            projectId = project.project_id;
        });

        it('should create a new phase in a project', async () => {
            const result = await addProjectPhase(phaseInput(projectId));

            expect(result).toMatchObject({
                project_id: projectId,
                phase_name: 'Test Phase',
                description: 'Test Phase Description',
                status: 'active'
            });

            expect(result.phase_id).toBeDefined();
            expect(result.wbs_code).toBeTruthy();

            const persisted = await db('project_phases')
                .where({ phase_id: result.phase_id, tenant: tenantId })
                .first();
            expect(persisted).toBeDefined();
        });

        it('should update phase details', async () => {
            const phase = await addProjectPhase(
                phaseInput(projectId, { phase_name: 'Initial Phase', description: 'Initial Description' })
            );

            const updatedPhase = await updatePhase(phase.phase_id, {
                phase_name: 'Updated Phase',
                description: 'Updated Description',
                status: 'completed'
            });

            expect(updatedPhase).toMatchObject({
                phase_id: phase.phase_id,
                phase_name: 'Updated Phase',
                description: 'Updated Description',
                status: 'completed'
            });

            const persisted = await db('project_phases')
                .where({ phase_id: phase.phase_id, tenant: tenantId })
                .first();
            expect(persisted.phase_name).toBe('Updated Phase');
        });
    });

    describe('Task Management', () => {
        let projectId: string;
        let phaseId: string;
        let statusMappingId: string;

        beforeEach(async () => {
            const project = await createProject(projectInput());
            projectId = project.project_id;

            const phase = await addProjectPhase(phaseInput(projectId));
            phaseId = phase.phase_id;

            statusMappingId = await firstStatusMappingId(projectId);
        });

        it('should create a new task in a phase', async () => {
            const result = await addTaskToPhase(phaseId, taskInput(statusMappingId), []);

            expect(result).toMatchObject({
                task_name: 'Test Task',
                description: 'Test Task Description',
                project_status_mapping_id: statusMappingId
            });
            // project_tasks.estimated_hours is numeric, which pg returns as a string.
            expect(Number(result!.estimated_hours)).toBe(8);

            expect(result?.task_id).toBeDefined();

            const persisted = await db('project_tasks')
                .where({ task_id: result!.task_id, tenant: tenantId })
                .first();
            expect(persisted.phase_id).toBe(phaseId);
        });

        it('should update task details', async () => {
            const task = await addTaskToPhase(
                phaseId,
                taskInput(statusMappingId, { task_name: 'Initial Task', description: 'Initial Description' }),
                []
            );

            if (!task) throw new Error('Task creation failed');

            const updatedTask = await updateTaskWithChecklist(task.task_id, {
                task_name: 'Updated Task',
                description: 'Updated Description',
                estimated_hours: 16
            });

            expect(updatedTask).toMatchObject({
                task_id: task.task_id,
                task_name: 'Updated Task',
                description: 'Updated Description'
            });
            expect(Number(updatedTask!.estimated_hours)).toBe(16);

            const persisted = await db('project_tasks')
                .where({ task_id: task.task_id, tenant: tenantId })
                .first();
            expect(persisted.task_name).toBe('Updated Task');
        });

        it('should move task to a different phase', async () => {
            const newPhase = await addProjectPhase(
                phaseInput(projectId, { phase_name: 'New Phase', description: 'New Phase Description', order_number: 2 })
            );

            const task = await addTaskToPhase(phaseId, taskInput(statusMappingId), []);
            if (!task) throw new Error('Task creation failed');

            const movedTask = await moveTaskToPhase(task.task_id, newPhase.phase_id);

            expect(movedTask).toMatchObject({
                task_id: task.task_id,
                phase_id: newPhase.phase_id,
                task_name: 'Test Task'
            });
            // The task is re-numbered under its new phase.
            expect(movedTask.wbs_code.startsWith(`${newPhase.wbs_code}.`)).toBe(true);

            const persisted = await db('project_tasks')
                .where({ task_id: task.task_id, tenant: tenantId })
                .first();
            expect(persisted.phase_id).toBe(newPhase.phase_id);
        });

        it('should move task to a different project', async () => {
            const newProject = await createProject(
                projectInput({ project_name: 'New Project', description: 'New Project Description' })
            );

            const newPhase = await addProjectPhase(
                phaseInput(newProject.project_id, { phase_name: 'New Phase', description: 'New Phase Description' })
            );

            const newStatusMappingId = await firstStatusMappingId(newProject.project_id);

            const task = await addTaskToPhase(phaseId, taskInput(statusMappingId), []);
            if (!task) throw new Error('Task creation failed');

            const movedTask = await moveTaskToPhase(task.task_id, newPhase.phase_id, newStatusMappingId);

            expect(movedTask).toMatchObject({
                task_id: task.task_id,
                phase_id: newPhase.phase_id,
                task_name: 'Test Task',
                project_status_mapping_id: newStatusMappingId
            });
            expect(movedTask.wbs_code.startsWith(`${newPhase.wbs_code}.`)).toBe(true);
        });
    });

    describe('Deletion Operations', () => {
        let projectId: string;
        let phaseId: string;
        let taskId: string;

        beforeEach(async () => {
            const project = await createProject(projectInput());
            projectId = project.project_id;

            const phase = await addProjectPhase(phaseInput(projectId));
            phaseId = phase.phase_id;

            const statusMappingId = await firstStatusMappingId(projectId);

            const task = await addTaskToPhase(phaseId, taskInput(statusMappingId), []);
            if (!task) throw new Error('Task creation failed');
            taskId = task.task_id;
        });

        it('should delete a task', async () => {
            await deleteTask(taskId);

            const persisted = await db('project_tasks')
                .where({ task_id: taskId, tenant: tenantId })
                .first();
            expect(persisted).toBeUndefined();
        });

        it('should delete a phase', async () => {
            await deletePhase(phaseId);

            const persisted = await db('project_phases')
                .where({ phase_id: phaseId, tenant: tenantId })
                .first();
            expect(persisted).toBeUndefined();
        });

        it('should delete a project', async () => {
            await deleteProject(projectId);

            const persisted = await db('projects')
                .where({ project_id: projectId, tenant: tenantId })
                .first();
            expect(persisted).toBeUndefined();
        });
    });
});
