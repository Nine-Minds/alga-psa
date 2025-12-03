import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import * as projectTemplateActions from '../../lib/actions/project-actions/projectTemplateActions';
import { IUser } from '../../interfaces/auth.interfaces';
import {
  IProjectTemplate,
  IProjectTemplatePhase,
  IProjectTemplateTask,
  IProjectTemplateDependency,
  IProjectTemplateChecklistItem,
  IProjectTemplateStatusMapping,
  IProjectTemplateWithDetails
} from '../../interfaces/projectTemplate.interfaces';

// Mock all external dependencies
vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/shared/db', () => ({
  withTransaction: vi.fn(),
}));

vi.mock('../../lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('../../lib/auth/rbac', () => ({
  hasPermission: vi.fn(),
}));

vi.mock('../../lib/actions/project-actions/projectActions', () => ({
  createProject: vi.fn(),
}));

vi.mock('../../lib/utils/validation', () => ({
  validateData: vi.fn((schema, data) => data),
}));

vi.mock('../../lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
}));

import { createTenantKnex } from '../../lib/db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../../lib/actions/user-actions/userActions';
import { hasPermission } from '../../lib/auth/rbac';
import { createProject } from '../../lib/actions/project-actions/projectActions';
import { validateData } from '../../lib/utils/validation';
import { publishEvent } from '../../lib/eventBus/publishers';

const cast = vi.mocked;

describe('Project Template Actions', () => {
  const createTenantKnexMock = cast(createTenantKnex);
  const withTransactionMock = cast(withTransaction);
  const getCurrentUserMock = cast(getCurrentUser);
  const hasPermissionMock = cast(hasPermission);
  const createProjectMock = cast(createProject);
  const validateDataMock = cast(validateData);
  const publishEventMock = cast(publishEvent);

  let knexStub: ReturnType<typeof createKnexStub>;
  const mockUser: IUser = {
    user_id: 'user-123',
    tenant: 'tenant-123',
    username: 'testuser',
    user_type: 'internal',
    hashed_password: 'hash'
  };

  beforeEach(() => {
    knexStub = createKnexStub();
    createTenantKnexMock.mockResolvedValue({ tenant: 'tenant-123', knex: knexStub.fn });
    withTransactionMock.mockImplementation(async (_knex: Knex, callback) => callback(knexStub.trx));
    getCurrentUserMock.mockResolvedValue(mockUser);
    hasPermissionMock.mockResolvedValue(true);
    publishEventMock.mockResolvedValue(undefined);
    validateDataMock.mockImplementation((schema, data) => data);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createTemplateFromProject', () => {
    it('should create template with phases and tasks', async () => {
      const projectId = 'project-123';
      const templateData = {
        template_name: 'Test Template',
        description: 'Template description',
        category: 'Standard'
      };

      // Mock project query
      knexStub.queries.projects.first.mockResolvedValue({
        project_id: projectId,
        tenant: 'tenant-123',
        project_name: 'Source Project'
      });

      // Mock phases query
      knexStub.queries.project_phases.orderBy.mockResolvedValue([
        {
          phase_id: 'phase-1',
          phase_name: 'Phase 1',
          description: 'First phase',
          order_key: 'a0',
          tenant: 'tenant-123'
        }
      ]);

      // Mock template insert
      knexStub.queries.project_templates.returning.mockResolvedValue([
        {
          template_id: 'template-123',
          template_name: templateData.template_name,
          description: templateData.description,
          category: templateData.category,
          tenant: 'tenant-123',
          created_by: mockUser.user_id,
          use_count: 0,
          created_at: new Date()
        }
      ]);

      // Mock template phase insert
      knexStub.queries.project_template_phases.returning.mockResolvedValue([
        {
          template_phase_id: 'template-phase-1',
          template_id: 'template-123',
          phase_name: 'Phase 1',
          tenant: 'tenant-123'
        }
      ]);

      // Mock tasks query
      knexStub.queries.project_tasks.orderBy.mockResolvedValue([]);

      const result = await projectTemplateActions.createTemplateFromProject(
        projectId,
        templateData
      );

      expect(result).toBe('template-123');
      expect(hasPermissionMock).toHaveBeenCalledWith(mockUser, 'project', 'create', knexStub.trx);
      expect(publishEventMock).toHaveBeenCalledWith({
        tenant_id: 'tenant-123',
        event_type: 'project_template.created',
        event_data: expect.objectContaining({
          template_id: 'template-123',
          source_project_id: projectId
        })
      });
    });

    it('should copy dependencies correctly with remapped IDs', async () => {
      const projectId = 'project-123';

      knexStub.queries.projects.first.mockResolvedValue({
        project_id: projectId,
        tenant: 'tenant-123'
      });

      knexStub.queries.project_phases.orderBy.mockResolvedValue([
        { phase_id: 'phase-1', tenant: 'tenant-123', order_key: 'a0' }
      ]);

      knexStub.queries.project_templates.returning.mockResolvedValue([
        { template_id: 'template-123', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_phases.returning.mockResolvedValue([
        { template_phase_id: 'template-phase-1', tenant: 'tenant-123' }
      ]);

      // Mock tasks with dependencies
      knexStub.queries.project_tasks.orderBy.mockResolvedValue([
        { task_id: 'task-1', phase_id: 'phase-1', tenant: 'tenant-123', task_name: 'Task 1' },
        { task_id: 'task-2', phase_id: 'phase-1', tenant: 'tenant-123', task_name: 'Task 2' }
      ]);

      knexStub.queries.project_template_tasks.returning.mockResolvedValueOnce([
        { template_task_id: 'template-task-1', tenant: 'tenant-123' }
      ]).mockResolvedValueOnce([
        { template_task_id: 'template-task-2', tenant: 'tenant-123' }
      ]);

      // Mock dependency query
      knexStub.queries.project_task_dependencies.whereIn.mockResolvedValue([
        {
          predecessor_task_id: 'task-1',
          successor_task_id: 'task-2',
          dependency_type: 'blocks',
          lead_lag_days: 0,
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_dependencies.insert.mockResolvedValue([{}]);
      knexStub.queries.task_checklist_items.whereIn.mockResolvedValue([]);
      knexStub.queries.project_status_mappings.where.mockResolvedValue([]);

      const result = await projectTemplateActions.createTemplateFromProject(
        projectId,
        { template_name: 'Test' }
      );

      expect(result).toBe('template-123');
      expect(knexStub.queries.project_template_dependencies.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          predecessor_task_id: 'template-task-1',
          successor_task_id: 'template-task-2',
          dependency_type: 'blocks'
        })
      );
    });

    it('should copy checklists with remapped task IDs', async () => {
      const projectId = 'project-123';

      knexStub.queries.projects.first.mockResolvedValue({
        project_id: projectId,
        tenant: 'tenant-123'
      });

      knexStub.queries.project_phases.orderBy.mockResolvedValue([
        { phase_id: 'phase-1', tenant: 'tenant-123', order_key: 'a0' }
      ]);

      knexStub.queries.project_templates.returning.mockResolvedValue([
        { template_id: 'template-123', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_phases.returning.mockResolvedValue([
        { template_phase_id: 'template-phase-1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_tasks.orderBy.mockResolvedValue([
        { task_id: 'task-1', phase_id: 'phase-1', tenant: 'tenant-123', task_name: 'Task 1' }
      ]);

      knexStub.queries.project_template_tasks.returning.mockResolvedValue([
        { template_task_id: 'template-task-1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_task_dependencies.whereIn.mockResolvedValue([]);

      // Mock checklist items
      knexStub.queries.task_checklist_items.whereIn.mockResolvedValue([
        {
          task_id: 'task-1',
          item_name: 'Checklist Item 1',
          description: 'Description',
          order_number: 1,
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_checklist_items.insert.mockResolvedValue([{}]);
      knexStub.queries.project_status_mappings.where.mockResolvedValue([]);

      const result = await projectTemplateActions.createTemplateFromProject(
        projectId,
        { template_name: 'Test' }
      );

      expect(result).toBe('template-123');
      expect(knexStub.queries.project_template_checklist_items.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          template_task_id: 'template-task-1',
          item_name: 'Checklist Item 1',
          order_number: 1
        })
      );
    });

    it('should copy status mappings', async () => {
      const projectId = 'project-123';

      knexStub.queries.projects.first.mockResolvedValue({
        project_id: projectId,
        tenant: 'tenant-123'
      });

      knexStub.queries.project_phases.orderBy.mockResolvedValue([]);

      knexStub.queries.project_templates.returning.mockResolvedValue([
        { template_id: 'template-123', tenant: 'tenant-123' }
      ]);

      // Mock status mappings
      knexStub.queries.project_status_mappings.where.mockResolvedValue([
        {
          status_id: 'status-1',
          custom_name: 'Custom Status',
          display_order: 1,
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_status_mappings.insert.mockResolvedValue([{}]);

      const result = await projectTemplateActions.createTemplateFromProject(
        projectId,
        { template_name: 'Test' }
      );

      expect(result).toBe('template-123');
      expect(knexStub.queries.project_template_status_mappings.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          template_id: 'template-123',
          status_id: 'status-1',
          custom_status_name: 'Custom Status',
          display_order: 1
        })
      );
    });

    it('should throw error if project not found', async () => {
      knexStub.queries.projects.first.mockResolvedValue(null);

      await expect(
        projectTemplateActions.createTemplateFromProject('invalid-id', {
          template_name: 'Test'
        })
      ).rejects.toThrow('Project not found');
    });

    it('should throw error if user has no permission', async () => {
      hasPermissionMock.mockResolvedValue(false);

      await expect(
        projectTemplateActions.createTemplateFromProject('project-123', {
          template_name: 'Test'
        })
      ).rejects.toThrow('Permission denied: Cannot create project');
    });

    it('should throw error if no authenticated user', async () => {
      getCurrentUserMock.mockResolvedValue(null);

      await expect(
        projectTemplateActions.createTemplateFromProject('project-123', {
          template_name: 'Test'
        })
      ).rejects.toThrow('No authenticated user found');
    });
  });

  describe('applyTemplate', () => {
    it('should create project from template with correct data', async () => {
      const templateId = 'template-123';
      const projectData = {
        project_name: 'New Project',
        client_id: 'client-123',
        start_date: '2024-01-01T00:00:00.000Z',
        assigned_to: 'user-456'
      };

      // Mock template query
      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        template_name: 'Test Template',
        description: 'Template description',
        tenant: 'tenant-123'
      });

      // Mock createProject
      createProjectMock.mockResolvedValue({
        project_id: 'new-project-123',
        project_name: projectData.project_name,
        wbs_code: '1',
        tenant: 'tenant-123'
      } as any);

      // Mock template phases
      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([]);
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue([]);

      // Mock template usage update
      knexStub.queries.project_templates.update.mockResolvedValue([{}]);

      const result = await projectTemplateActions.applyTemplate(
        templateId,
        projectData
      );

      expect(result).toBe('new-project-123');
      expect(createProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          project_name: projectData.project_name,
          client_id: projectData.client_id,
          assigned_to: projectData.assigned_to,
          start_date: projectData.start_date,
          description: 'Template description'
        })
      );
    });

    it('should calculate dates based on start_date and offsets', async () => {
      const templateId = 'template-123';
      const startDate = '2024-01-01T00:00:00.000Z';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        tenant: 'tenant-123'
      });

      createProjectMock.mockResolvedValue({
        project_id: 'new-project-123',
        wbs_code: '1',
        tenant: 'tenant-123'
      } as any);

      // Mock template phases with offsets and durations
      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([
        {
          template_phase_id: 'template-phase-1',
          phase_name: 'Phase 1',
          start_offset_days: 0,
          duration_days: 7,
          order_key: 'a0',
          tenant: 'tenant-123'
        },
        {
          template_phase_id: 'template-phase-2',
          phase_name: 'Phase 2',
          start_offset_days: 10,
          duration_days: 14,
          order_key: 'a1',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_phases.select.mockResolvedValue([]);
      knexStub.queries.project_phases.returning.mockResolvedValueOnce([
        { phase_id: 'phase-1', wbs_code: '1.1', tenant: 'tenant-123' }
      ]).mockResolvedValueOnce([
        { phase_id: 'phase-2', wbs_code: '1.2', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_tasks.orderBy.mockResolvedValue([]);
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue([]);
      knexStub.queries.project_templates.update.mockResolvedValue([{}]);

      const result = await projectTemplateActions.applyTemplate(templateId, {
        project_name: 'Test Project',
        client_id: 'client-123',
        start_date: startDate
      });

      expect(result).toBe('new-project-123');

      // Verify phases were created with calculated dates
      const phaseInserts = knexStub.queries.project_phases.insert.mock.calls;
      expect(phaseInserts).toHaveLength(2);

      // First phase: start_date = 2024-01-01, end_date = 2024-01-08 (start + 7 days)
      expect(phaseInserts[0][0]).toMatchObject({
        phase_name: 'Phase 1'
      });

      // Second phase: start_date = 2024-01-11 (start + 10 days), end_date = 2024-01-25 (start + 10 + 14 days)
      expect(phaseInserts[1][0]).toMatchObject({
        phase_name: 'Phase 2'
      });
    });

    it('should generate correct WBS codes for phases and tasks', async () => {
      const templateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        tenant: 'tenant-123'
      });

      createProjectMock.mockResolvedValue({
        project_id: 'new-project-123',
        wbs_code: '1',
        tenant: 'tenant-123'
      } as any);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([
        {
          template_phase_id: 'template-phase-1',
          phase_name: 'Phase 1',
          start_offset_days: 0,
          order_key: 'a0',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_phases.select.mockResolvedValue([]);
      knexStub.queries.project_phases.first.mockResolvedValue({
        phase_id: 'phase-1',
        wbs_code: '1.1',
        tenant: 'tenant-123'
      });
      knexStub.queries.project_phases.returning.mockResolvedValue([
        { phase_id: 'phase-1', wbs_code: '1.1', tenant: 'tenant-123' }
      ]);

      // Mock template tasks
      knexStub.queries.project_template_tasks.orderBy.mockResolvedValue([
        {
          template_task_id: 'template-task-1',
          template_phase_id: 'template-phase-1',
          task_name: 'Task 1',
          order_key: 'a0',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_tasks.select.mockResolvedValue([]);
      knexStub.queries.project_status_mappings.orderBy.mockResolvedValue([
        { project_status_mapping_id: 'mapping-1', tenant: 'tenant-123' }
      ]);
      knexStub.queries.project_tasks.returning.mockResolvedValue([
        { task_id: 'task-1', wbs_code: '1.1.1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_dependencies.where.mockResolvedValue([]);
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue([]);
      knexStub.queries.project_templates.update.mockResolvedValue([{}]);

      const result = await projectTemplateActions.applyTemplate(templateId, {
        project_name: 'Test Project',
        client_id: 'client-123'
      });

      expect(result).toBe('new-project-123');

      // Verify WBS code generation
      const phaseInsert = knexStub.queries.project_phases.insert.mock.calls[0][0];
      expect(phaseInsert.wbs_code).toBe('1.1');

      const taskInsert = knexStub.queries.project_tasks.insert.mock.calls[0][0];
      expect(taskInsert.wbs_code).toBe('1.1.1');
    });

    it('should increment template use_count', async () => {
      const templateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        tenant: 'tenant-123'
      });

      createProjectMock.mockResolvedValue({
        project_id: 'new-project-123',
        wbs_code: '1',
        tenant: 'tenant-123'
      } as any);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([]);
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue([]);
      knexStub.queries.project_templates.update.mockResolvedValue([{}]);

      await projectTemplateActions.applyTemplate(templateId, {
        project_name: 'Test Project',
        client_id: 'client-123'
      });

      expect(knexStub.queries.project_templates.increment).toHaveBeenCalledWith('use_count', 1);
      expect(knexStub.queries.project_templates.update).toHaveBeenCalledWith(
        expect.objectContaining({
          last_used_at: expect.anything(),
          updated_at: expect.anything()
        })
      );
    });

    it('should remap dependency IDs when creating project', async () => {
      const templateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        tenant: 'tenant-123'
      });

      createProjectMock.mockResolvedValue({
        project_id: 'new-project-123',
        wbs_code: '1',
        tenant: 'tenant-123'
      } as any);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([
        {
          template_phase_id: 'template-phase-1',
          phase_name: 'Phase 1',
          order_key: 'a0',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_phases.select.mockResolvedValue([]);
      knexStub.queries.project_phases.first.mockResolvedValue({
        phase_id: 'phase-1',
        wbs_code: '1.1',
        tenant: 'tenant-123'
      });
      knexStub.queries.project_phases.returning.mockResolvedValue([
        { phase_id: 'phase-1', wbs_code: '1.1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_tasks.orderBy.mockResolvedValue([
        {
          template_task_id: 'template-task-1',
          template_phase_id: 'template-phase-1',
          task_name: 'Task 1',
          tenant: 'tenant-123'
        },
        {
          template_task_id: 'template-task-2',
          template_phase_id: 'template-phase-1',
          task_name: 'Task 2',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_tasks.select.mockResolvedValue([]);
      knexStub.queries.project_status_mappings.orderBy.mockResolvedValue([
        { project_status_mapping_id: 'mapping-1', tenant: 'tenant-123' }
      ]);
      knexStub.queries.project_tasks.returning
        .mockResolvedValueOnce([{ task_id: 'task-1', wbs_code: '1.1.1', tenant: 'tenant-123' }])
        .mockResolvedValueOnce([{ task_id: 'task-2', wbs_code: '1.1.2', tenant: 'tenant-123' }]);

      // Mock template dependencies
      knexStub.queries.project_template_dependencies.where.mockResolvedValue([
        {
          predecessor_task_id: 'template-task-1',
          successor_task_id: 'template-task-2',
          dependency_type: 'blocks',
          lead_lag_days: 0,
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_task_dependencies.insert.mockResolvedValue([{}]);
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue([]);
      knexStub.queries.project_templates.update.mockResolvedValue([{}]);

      await projectTemplateActions.applyTemplate(templateId, {
        project_name: 'Test Project',
        client_id: 'client-123'
      });

      expect(knexStub.queries.project_task_dependencies.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          predecessor_task_id: 'task-1',
          successor_task_id: 'task-2',
          dependency_type: 'blocks'
        })
      );
    });

    it('should copy checklist items when creating project', async () => {
      const templateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        tenant: 'tenant-123'
      });

      createProjectMock.mockResolvedValue({
        project_id: 'new-project-123',
        wbs_code: '1',
        tenant: 'tenant-123'
      } as any);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([
        {
          template_phase_id: 'template-phase-1',
          phase_name: 'Phase 1',
          order_key: 'a0',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_phases.select.mockResolvedValue([]);
      knexStub.queries.project_phases.first.mockResolvedValue({
        phase_id: 'phase-1',
        wbs_code: '1.1',
        tenant: 'tenant-123'
      });
      knexStub.queries.project_phases.returning.mockResolvedValue([
        { phase_id: 'phase-1', wbs_code: '1.1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_tasks.orderBy.mockResolvedValue([
        {
          template_task_id: 'template-task-1',
          template_phase_id: 'template-phase-1',
          task_name: 'Task 1',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_tasks.select.mockResolvedValue([]);
      knexStub.queries.project_status_mappings.orderBy.mockResolvedValue([
        { project_status_mapping_id: 'mapping-1', tenant: 'tenant-123' }
      ]);
      knexStub.queries.project_tasks.returning.mockResolvedValue([
        { task_id: 'task-1', wbs_code: '1.1.1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_dependencies.where.mockResolvedValue([]);

      // Mock template checklist items
      knexStub.queries.project_template_checklist_items.whereIn.mockResolvedValue([
        {
          template_task_id: 'template-task-1',
          item_name: 'Checklist Item 1',
          description: 'Description',
          order_number: 1,
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.task_checklist_items.insert.mockResolvedValue([{}]);
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue([]);
      knexStub.queries.project_templates.update.mockResolvedValue([{}]);

      await projectTemplateActions.applyTemplate(templateId, {
        project_name: 'Test Project',
        client_id: 'client-123'
      });

      expect(knexStub.queries.task_checklist_items.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'task-1',
          item_name: 'Checklist Item 1',
          order_number: 1,
          completed: false
        })
      );
    });

    it('should replace default status mappings with template mappings', async () => {
      const templateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        tenant: 'tenant-123'
      });

      createProjectMock.mockResolvedValue({
        project_id: 'new-project-123',
        wbs_code: '1',
        tenant: 'tenant-123'
      } as any);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([]);

      // Mock template status mappings
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue([
        {
          status_id: 'status-1',
          custom_status_name: 'Custom Status',
          display_order: 1,
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_status_mappings.delete.mockResolvedValue(1);
      knexStub.queries.project_status_mappings.insert.mockResolvedValue([{}]);
      knexStub.queries.project_templates.update.mockResolvedValue([{}]);

      await projectTemplateActions.applyTemplate(templateId, {
        project_name: 'Test Project',
        client_id: 'client-123'
      });

      expect(knexStub.queries.project_status_mappings.delete).toHaveBeenCalled();
      expect(knexStub.queries.project_status_mappings.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          status_id: 'status-1',
          custom_name: 'Custom Status',
          display_order: 1,
          is_visible: true,
          is_standard: true
        })
      );
    });

    it('should validate input data', async () => {
      const templateId = 'template-123';
      const projectData = {
        project_name: 'Test Project',
        client_id: 'client-123'
      };

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        tenant: 'tenant-123'
      });

      createProjectMock.mockResolvedValue({
        project_id: 'new-project-123',
        wbs_code: '1',
        tenant: 'tenant-123'
      } as any);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([]);
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue([]);
      knexStub.queries.project_templates.update.mockResolvedValue([{}]);

      await projectTemplateActions.applyTemplate(templateId, projectData);

      expect(validateDataMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          template_id: templateId,
          ...projectData
        })
      );
    });

    it('should throw error if template not found', async () => {
      knexStub.queries.project_templates.first.mockResolvedValue(null);

      await expect(
        projectTemplateActions.applyTemplate('invalid-id', {
          project_name: 'Test',
          client_id: 'client-123'
        })
      ).rejects.toThrow('Template not found');
    });

    it('should throw error if user has no permission', async () => {
      hasPermissionMock.mockResolvedValue(false);

      await expect(
        projectTemplateActions.applyTemplate('template-123', {
          project_name: 'Test',
          client_id: 'client-123'
        })
      ).rejects.toThrow('Permission denied: Cannot create project');
    });

    it('should throw error if no authenticated user', async () => {
      getCurrentUserMock.mockResolvedValue(null);

      await expect(
        projectTemplateActions.applyTemplate('template-123', {
          project_name: 'Test',
          client_id: 'client-123'
        })
      ).rejects.toThrow('No authenticated user found');
    });
  });

  describe('updateTemplate', () => {
    it('should update template metadata', async () => {
      const templateId = 'template-123';
      const updateData = {
        template_name: 'Updated Template',
        description: 'Updated description',
        category: 'Updated Category'
      };

      knexStub.queries.project_templates.returning.mockResolvedValue([
        {
          template_id: templateId,
          ...updateData,
          tenant: 'tenant-123',
          updated_at: new Date()
        }
      ]);

      const result = await projectTemplateActions.updateTemplate(templateId, updateData);

      expect(result.template_name).toBe(updateData.template_name);
      expect(hasPermissionMock).toHaveBeenCalledWith(mockUser, 'project', 'update', knexStub.trx);
      expect(knexStub.queries.project_templates.update).toHaveBeenCalledWith(
        expect.objectContaining(updateData)
      );
      expect(publishEventMock).toHaveBeenCalledWith({
        tenant_id: 'tenant-123',
        event_type: 'project_template.updated',
        event_data: expect.objectContaining({
          template_id: templateId
        })
      });
    });

    it('should allow partial updates', async () => {
      const templateId = 'template-123';
      const updateData = { template_name: 'Updated Name' };

      knexStub.queries.project_templates.returning.mockResolvedValue([
        {
          template_id: templateId,
          template_name: updateData.template_name,
          tenant: 'tenant-123'
        }
      ]);

      const result = await projectTemplateActions.updateTemplate(templateId, updateData);

      expect(result.template_name).toBe(updateData.template_name);
    });

    it('should validate update data', async () => {
      const templateId = 'template-123';
      const updateData = { template_name: 'Updated Name' };

      knexStub.queries.project_templates.returning.mockResolvedValue([
        {
          template_id: templateId,
          template_name: updateData.template_name,
          tenant: 'tenant-123'
        }
      ]);

      await projectTemplateActions.updateTemplate(templateId, updateData);

      expect(validateDataMock).toHaveBeenCalledWith(
        expect.anything(),
        updateData
      );
    });

    it('should throw error if template not found', async () => {
      knexStub.queries.project_templates.returning.mockResolvedValue([]);

      await expect(
        projectTemplateActions.updateTemplate('invalid-id', { template_name: 'Test' })
      ).rejects.toThrow('Template not found');
    });

    it('should throw error if user has no permission', async () => {
      hasPermissionMock.mockResolvedValue(false);

      await expect(
        projectTemplateActions.updateTemplate('template-123', { template_name: 'Test' })
      ).rejects.toThrow('Permission denied: Cannot update project');
    });

    it('should throw error if no authenticated user', async () => {
      getCurrentUserMock.mockResolvedValue(null);

      await expect(
        projectTemplateActions.updateTemplate('template-123', { template_name: 'Test' })
      ).rejects.toThrow('No authenticated user found');
    });
  });

  describe('deleteTemplate', () => {
    it('should delete template', async () => {
      const templateId = 'template-123';

      knexStub.queries.project_templates.delete.mockResolvedValue(1);

      await projectTemplateActions.deleteTemplate(templateId);

      expect(hasPermissionMock).toHaveBeenCalledWith(mockUser, 'project', 'delete', knexStub.trx);
      expect(knexStub.queries.project_templates.delete).toHaveBeenCalled();
      expect(publishEventMock).toHaveBeenCalledWith({
        tenant_id: 'tenant-123',
        event_type: 'project_template.deleted',
        event_data: expect.objectContaining({
          template_id: templateId
        })
      });
    });

    it('should throw error if template not found', async () => {
      knexStub.queries.project_templates.delete.mockResolvedValue(0);

      await expect(
        projectTemplateActions.deleteTemplate('invalid-id')
      ).rejects.toThrow('Template not found');
    });

    it('should throw error if user has no permission', async () => {
      hasPermissionMock.mockResolvedValue(false);

      await expect(
        projectTemplateActions.deleteTemplate('template-123')
      ).rejects.toThrow('Permission denied: Cannot delete project');
    });

    it('should throw error if no authenticated user', async () => {
      getCurrentUserMock.mockResolvedValue(null);

      await expect(
        projectTemplateActions.deleteTemplate('template-123')
      ).rejects.toThrow('No authenticated user found');
    });
  });

  describe('duplicateTemplate', () => {
    it('should duplicate template with all related data', async () => {
      const originalTemplateId = 'template-123';

      // Mock original template
      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: originalTemplateId,
        template_name: 'Original Template',
        description: 'Description',
        category: 'Category',
        tenant: 'tenant-123'
      });

      // Mock new template insert
      knexStub.queries.project_templates.returning.mockResolvedValue([
        {
          template_id: 'template-456',
          template_name: 'Original Template (Copy)',
          description: 'Description',
          category: 'Category',
          tenant: 'tenant-123',
          use_count: 0
        }
      ]);

      // Mock phases
      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([
        {
          template_phase_id: 'phase-1',
          phase_name: 'Phase 1',
          tenant: 'tenant-123',
          order_key: 'a0'
        }
      ]);

      knexStub.queries.project_template_phases.returning.mockResolvedValue([
        {
          template_phase_id: 'new-phase-1',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_tasks.whereIn.mockResolvedValue([]);
      knexStub.queries.project_template_dependencies.where.mockResolvedValue([]);
      knexStub.queries.project_template_status_mappings.where.mockResolvedValue([]);

      const result = await projectTemplateActions.duplicateTemplate(originalTemplateId);

      expect(result).toBe('template-456');
      expect(knexStub.queries.project_templates.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          template_name: 'Original Template (Copy)',
          use_count: 0
        })
      );
    });

    it('should remap phase IDs when duplicating', async () => {
      const originalTemplateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: originalTemplateId,
        template_name: 'Original',
        tenant: 'tenant-123'
      });

      knexStub.queries.project_templates.returning.mockResolvedValue([
        { template_id: 'template-456', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([
        {
          template_phase_id: 'old-phase-1',
          phase_name: 'Phase 1',
          duration_days: 7,
          start_offset_days: 0,
          order_key: 'a0',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_phases.returning.mockResolvedValue([
        {
          template_phase_id: 'new-phase-1',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_tasks.whereIn.mockResolvedValue([
        {
          template_task_id: 'old-task-1',
          template_phase_id: 'old-phase-1',
          task_name: 'Task 1',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_tasks.returning.mockResolvedValue([
        {
          template_task_id: 'new-task-1',
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_dependencies.where.mockResolvedValue([]);
      knexStub.queries.project_template_checklist_items.whereIn.mockResolvedValue([]);
      knexStub.queries.project_template_status_mappings.where.mockResolvedValue([]);

      const result = await projectTemplateActions.duplicateTemplate(originalTemplateId);

      expect(result).toBe('template-456');
      expect(knexStub.queries.project_template_tasks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          template_phase_id: 'new-phase-1',
          task_name: 'Task 1'
        })
      );
    });

    it('should remap task IDs in dependencies when duplicating', async () => {
      const originalTemplateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: originalTemplateId,
        template_name: 'Original',
        tenant: 'tenant-123'
      });

      knexStub.queries.project_templates.returning.mockResolvedValue([
        { template_id: 'template-456', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([
        {
          template_phase_id: 'old-phase-1',
          tenant: 'tenant-123',
          order_key: 'a0'
        }
      ]);

      knexStub.queries.project_template_phases.returning.mockResolvedValue([
        { template_phase_id: 'new-phase-1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_tasks.whereIn.mockResolvedValue([
        { template_task_id: 'old-task-1', template_phase_id: 'old-phase-1', tenant: 'tenant-123' },
        { template_task_id: 'old-task-2', template_phase_id: 'old-phase-1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_tasks.returning
        .mockResolvedValueOnce([{ template_task_id: 'new-task-1', tenant: 'tenant-123' }])
        .mockResolvedValueOnce([{ template_task_id: 'new-task-2', tenant: 'tenant-123' }]);

      knexStub.queries.project_template_dependencies.where.mockResolvedValue([
        {
          predecessor_task_id: 'old-task-1',
          successor_task_id: 'old-task-2',
          dependency_type: 'blocks',
          lead_lag_days: 0,
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_dependencies.insert.mockResolvedValue([{}]);
      knexStub.queries.project_template_checklist_items.whereIn.mockResolvedValue([]);
      knexStub.queries.project_template_status_mappings.where.mockResolvedValue([]);

      const result = await projectTemplateActions.duplicateTemplate(originalTemplateId);

      expect(result).toBe('template-456');
      expect(knexStub.queries.project_template_dependencies.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          predecessor_task_id: 'new-task-1',
          successor_task_id: 'new-task-2',
          dependency_type: 'blocks'
        })
      );
    });

    it('should remap task IDs in checklists when duplicating', async () => {
      const originalTemplateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: originalTemplateId,
        template_name: 'Original',
        tenant: 'tenant-123'
      });

      knexStub.queries.project_templates.returning.mockResolvedValue([
        { template_id: 'template-456', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([
        { template_phase_id: 'old-phase-1', tenant: 'tenant-123', order_key: 'a0' }
      ]);

      knexStub.queries.project_template_phases.returning.mockResolvedValue([
        { template_phase_id: 'new-phase-1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_tasks.whereIn.mockResolvedValue([
        { template_task_id: 'old-task-1', template_phase_id: 'old-phase-1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_tasks.returning.mockResolvedValue([
        { template_task_id: 'new-task-1', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_dependencies.where.mockResolvedValue([]);

      knexStub.queries.project_template_checklist_items.whereIn.mockResolvedValue([
        {
          template_task_id: 'old-task-1',
          item_name: 'Checklist Item 1',
          order_number: 1,
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_checklist_items.insert.mockResolvedValue([{}]);
      knexStub.queries.project_template_status_mappings.where.mockResolvedValue([]);

      const result = await projectTemplateActions.duplicateTemplate(originalTemplateId);

      expect(result).toBe('template-456');
      expect(knexStub.queries.project_template_checklist_items.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          template_task_id: 'new-task-1',
          item_name: 'Checklist Item 1'
        })
      );
    });

    it('should copy status mappings when duplicating', async () => {
      const originalTemplateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: originalTemplateId,
        template_name: 'Original',
        tenant: 'tenant-123'
      });

      knexStub.queries.project_templates.returning.mockResolvedValue([
        { template_id: 'template-456', tenant: 'tenant-123' }
      ]);

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([]);

      knexStub.queries.project_template_status_mappings.where.mockResolvedValue([
        {
          status_id: 'status-1',
          custom_status_name: 'Custom Status',
          display_order: 1,
          tenant: 'tenant-123'
        }
      ]);

      knexStub.queries.project_template_status_mappings.insert.mockResolvedValue([{}]);

      const result = await projectTemplateActions.duplicateTemplate(originalTemplateId);

      expect(result).toBe('template-456');
      expect(knexStub.queries.project_template_status_mappings.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          template_id: 'template-456',
          status_id: 'status-1',
          custom_status_name: 'Custom Status',
          display_order: 1
        })
      );
    });

    it('should throw error if template not found', async () => {
      knexStub.queries.project_templates.first.mockResolvedValue(null);

      await expect(
        projectTemplateActions.duplicateTemplate('invalid-id')
      ).rejects.toThrow('Template not found');
    });

    it('should throw error if user has no permission', async () => {
      hasPermissionMock.mockResolvedValue(false);

      await expect(
        projectTemplateActions.duplicateTemplate('template-123')
      ).rejects.toThrow('Permission denied: Cannot create project');
    });

    it('should throw error if no authenticated user', async () => {
      getCurrentUserMock.mockResolvedValue(null);

      await expect(
        projectTemplateActions.duplicateTemplate('template-123')
      ).rejects.toThrow('No authenticated user found');
    });
  });

  describe('getTemplates', () => {
    it('should return all templates', async () => {
      const mockTemplates = [
        {
          template_id: 'template-1',
          template_name: 'Template 1',
          tenant: 'tenant-123'
        },
        {
          template_id: 'template-2',
          template_name: 'Template 2',
          tenant: 'tenant-123'
        }
      ];

      knexStub.queries.project_templates.orderBy.mockResolvedValue(mockTemplates);

      const result = await projectTemplateActions.getTemplates();

      expect(result).toEqual(mockTemplates);
      expect(hasPermissionMock).toHaveBeenCalledWith(mockUser, 'project', 'read', knexStub.fn);
    });

    it('should filter by category', async () => {
      const mockTemplates = [
        {
          template_id: 'template-1',
          template_name: 'Template 1',
          category: 'Standard',
          tenant: 'tenant-123'
        }
      ];

      knexStub.queries.project_templates.orderBy.mockResolvedValue(mockTemplates);

      const result = await projectTemplateActions.getTemplates({
        category: 'Standard'
      });

      expect(result).toEqual(mockTemplates);
      expect(knexStub.queries.project_templates.where).toHaveBeenCalledWith('category', 'Standard');
    });

    it('should search by template name', async () => {
      const mockTemplates = [
        {
          template_id: 'template-1',
          template_name: 'Web Development Template',
          tenant: 'tenant-123'
        }
      ];

      knexStub.queries.project_templates.orderBy.mockResolvedValue(mockTemplates);

      const result = await projectTemplateActions.getTemplates({
        search: 'Web'
      });

      expect(result).toEqual(mockTemplates);
    });

    it('should search by description', async () => {
      const mockTemplates = [
        {
          template_id: 'template-1',
          template_name: 'Template 1',
          description: 'Web development template',
          tenant: 'tenant-123'
        }
      ];

      knexStub.queries.project_templates.orderBy.mockResolvedValue(mockTemplates);

      const result = await projectTemplateActions.getTemplates({
        search: 'development'
      });

      expect(result).toEqual(mockTemplates);
    });

    it('should combine category and search filters', async () => {
      const mockTemplates = [
        {
          template_id: 'template-1',
          template_name: 'Standard Web Template',
          category: 'Standard',
          tenant: 'tenant-123'
        }
      ];

      knexStub.queries.project_templates.orderBy.mockResolvedValue(mockTemplates);

      const result = await projectTemplateActions.getTemplates({
        category: 'Standard',
        search: 'Web'
      });

      expect(result).toEqual(mockTemplates);
    });

    it('should throw error if user has no permission', async () => {
      hasPermissionMock.mockResolvedValue(false);

      await expect(
        projectTemplateActions.getTemplates()
      ).rejects.toThrow('Permission denied: Cannot read project');
    });

    it('should throw error if no authenticated user', async () => {
      getCurrentUserMock.mockResolvedValue(null);

      await expect(
        projectTemplateActions.getTemplates()
      ).rejects.toThrow('No authenticated user found');
    });
  });

  describe('getTemplateWithDetails', () => {
    it('should load template with all related data', async () => {
      const templateId = 'template-123';

      // Mock template
      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        template_name: 'Test Template',
        tenant: 'tenant-123'
      });

      // Mock phases
      const mockPhases = [
        {
          template_phase_id: 'phase-1',
          template_id: templateId,
          phase_name: 'Phase 1',
          tenant: 'tenant-123'
        }
      ];

      // Mock tasks
      const mockTasks = [
        {
          template_task_id: 'task-1',
          template_phase_id: 'phase-1',
          task_name: 'Task 1',
          tenant: 'tenant-123'
        }
      ];

      // Mock dependencies
      const mockDependencies = [
        {
          template_dependency_id: 'dep-1',
          template_id: templateId,
          predecessor_task_id: 'task-1',
          successor_task_id: 'task-2',
          dependency_type: 'blocks' as const,
          tenant: 'tenant-123'
        }
      ];

      // Mock checklist items
      const mockChecklistItems = [
        {
          template_checklist_id: 'checklist-1',
          template_task_id: 'task-1',
          item_name: 'Item 1',
          tenant: 'tenant-123'
        }
      ];

      // Mock status mappings
      const mockStatusMappings = [
        {
          template_status_mapping_id: 'mapping-1',
          template_id: templateId,
          status_id: 'status-1',
          tenant: 'tenant-123'
        }
      ];

      // Setup Promise.all mocks
      knexStub.queries.project_template_phases.orderBy.mockResolvedValue(mockPhases);
      knexStub.queries.project_template_dependencies.where.mockResolvedValue(mockDependencies);
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue(mockStatusMappings);
      knexStub.queries.project_template_tasks.orderBy.mockResolvedValue(mockTasks);
      knexStub.queries.project_template_checklist_items.orderBy.mockResolvedValue(mockChecklistItems);

      const result = await projectTemplateActions.getTemplateWithDetails(templateId);

      expect(result).toEqual({
        template_id: templateId,
        template_name: 'Test Template',
        tenant: 'tenant-123',
        phases: mockPhases,
        tasks: mockTasks,
        dependencies: mockDependencies,
        checklist_items: mockChecklistItems,
        status_mappings: mockStatusMappings
      });
    });

    it('should return null if template not found', async () => {
      knexStub.queries.project_templates.first.mockResolvedValue(null);

      const result = await projectTemplateActions.getTemplateWithDetails('invalid-id');

      expect(result).toBeNull();
    });

    it('should handle templates with no phases', async () => {
      const templateId = 'template-123';

      knexStub.queries.project_templates.first.mockResolvedValue({
        template_id: templateId,
        template_name: 'Test Template',
        tenant: 'tenant-123'
      });

      knexStub.queries.project_template_phases.orderBy.mockResolvedValue([]);
      knexStub.queries.project_template_dependencies.where.mockResolvedValue([]);
      knexStub.queries.project_template_status_mappings.orderBy.mockResolvedValue([]);

      const result = await projectTemplateActions.getTemplateWithDetails(templateId);

      expect(result).toEqual({
        template_id: templateId,
        template_name: 'Test Template',
        tenant: 'tenant-123',
        phases: [],
        tasks: [],
        dependencies: [],
        checklist_items: [],
        status_mappings: []
      });
    });

    it('should throw error if user has no permission', async () => {
      hasPermissionMock.mockResolvedValue(false);

      await expect(
        projectTemplateActions.getTemplateWithDetails('template-123')
      ).rejects.toThrow('Permission denied: Cannot read project');
    });

    it('should throw error if no authenticated user', async () => {
      getCurrentUserMock.mockResolvedValue(null);

      await expect(
        projectTemplateActions.getTemplateWithDetails('template-123')
      ).rejects.toThrow('No authenticated user found');
    });
  });
});

/**
 * Create a knex stub for testing
 */
function createKnexStub() {
  const queries: Record<string, any> = {};

  const createQueryBuilder = (tableName: string) => {
    if (!queries[tableName]) {
      queries[tableName] = {
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockResolvedValue(0),
        where: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        whereNotNull: vi.fn().mockReturnThis(),
        andOn: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(null),
        distinct: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
        increment: vi.fn().mockReturnThis(),
      };
    }
    return queries[tableName];
  };

  const knexFn = vi.fn((tableName: string) => createQueryBuilder(tableName));
  knexFn.fn = { now: () => new Date() };

  const trx = ((tableName: string) => createQueryBuilder(tableName)) as unknown as Knex.Transaction;

  return {
    fn: knexFn as unknown as Knex,
    trx,
    queries
  };
}
