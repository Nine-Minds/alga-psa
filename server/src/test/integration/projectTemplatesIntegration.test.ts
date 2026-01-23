import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { TestContext } from '../../../test-utils/testContext';
import {
  createTemplateFromProject,
  applyTemplate,
  getTemplateWithDetails,
  getTemplates
} from '@alga-psa/projects/actions/projectTemplateActions';

// Mock authentication and permissions
let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
  getCurrentUser: vi.fn(async () => ({
    user_id: mockedUserId,
    tenant: mockedTenantId,
    user_type: 'internal',
    roles: []
  }))
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => Promise.resolve())
}));

describe('Project Templates Integration Tests', () => {
  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext
  } = TestContext.createHelpers();

  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'project_template_checklist_items',
        'project_template_dependencies',
        'project_template_tasks',
        'project_template_phases',
        'project_template_status_mappings',
        'project_templates',
        'task_checklist_items',
        'project_task_dependencies',
        'project_tasks',
        'project_phases',
        'project_status_mappings',
        'projects'
      ],
      clientName: 'Test Client for Templates',
      userType: 'internal'
    });

    mockedTenantId = context.tenantId;
    mockedUserId = context.userId;
  }, 120000);

  afterAll(async () => {
    await cleanupContext();
  });

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantId = context.tenantId;
    mockedUserId = context.userId;
  });

  afterEach(async () => {
    await rollbackContext();
  });

  describe('Creating template from project with full structure', () => {
    it('should create template from project with phases, tasks, dependencies, and checklists', async () => {
      // 1. Create a source project with complete structure
      const [project] = await context.db('projects')
        .insert({
          tenant: context.tenantId,
          project_name: 'Source Project for Template',
          wbs_code: '1',
          client_id: context.clientId,
          status: 'active'
        })
        .returning('*');

      // 2. Create project status mappings
      const [statusMapping1] = await context.db('project_status_mappings')
        .insert({
          tenant: context.tenantId,
          project_id: project.project_id,
          status_id: null,
          custom_name: 'Not Started',
          display_order: 1,
          is_visible: true,
          is_standard: false
        })
        .returning('*');

      // 3. Create phases
      const [phase1] = await context.db('project_phases')
        .insert({
          tenant: context.tenantId,
          project_id: project.project_id,
          phase_name: 'Phase 1: Planning',
          description: 'Initial planning phase',
          wbs_code: '1.1',
          order_key: 'a0',
          status: 'not_started'
        })
        .returning('*');

      const [phase2] = await context.db('project_phases')
        .insert({
          tenant: context.tenantId,
          project_id: project.project_id,
          phase_name: 'Phase 2: Execution',
          description: 'Execution phase',
          wbs_code: '1.2',
          order_key: 'a1',
          status: 'not_started'
        })
        .returning('*');

      // 4. Create tasks
      const [task1] = await context.db('project_tasks')
        .insert({
          tenant: context.tenantId,
          phase_id: phase1.phase_id,
          task_name: 'Task 1: Requirements',
          description: 'Gather requirements',
          estimated_hours: 10,
          wbs_code: '1.1.1',
          order_key: 'a0',
          task_type_key: 'task',
          project_status_mapping_id: statusMapping1.project_status_mapping_id
        })
        .returning('*');

      const [task2] = await context.db('project_tasks')
        .insert({
          tenant: context.tenantId,
          phase_id: phase1.phase_id,
          task_name: 'Task 2: Design',
          description: 'Create design documents',
          estimated_hours: 15,
          wbs_code: '1.1.2',
          order_key: 'a1',
          task_type_key: 'task',
          project_status_mapping_id: statusMapping1.project_status_mapping_id
        })
        .returning('*');

      const [task3] = await context.db('project_tasks')
        .insert({
          tenant: context.tenantId,
          phase_id: phase2.phase_id,
          task_name: 'Task 3: Implementation',
          description: 'Implement the solution',
          estimated_hours: 40,
          wbs_code: '1.2.1',
          order_key: 'a0',
          task_type_key: 'task',
          project_status_mapping_id: statusMapping1.project_status_mapping_id
        })
        .returning('*');

      // 5. Create dependencies
      await context.db('project_task_dependencies')
        .insert([
          {
            tenant: context.tenantId,
            predecessor_task_id: task1.task_id,
            successor_task_id: task2.task_id,
            dependency_type: 'finish_to_start',
            lead_lag_days: 0
          },
          {
            tenant: context.tenantId,
            predecessor_task_id: task2.task_id,
            successor_task_id: task3.task_id,
            dependency_type: 'finish_to_start',
            lead_lag_days: 2
          }
        ]);

      // 6. Create checklists
      await context.db('task_checklist_items')
        .insert([
          {
            tenant: context.tenantId,
            task_id: task1.task_id,
            item_name: 'Review stakeholder list',
            description: 'Ensure all stakeholders are identified',
            order_number: 1,
            completed: false
          },
          {
            tenant: context.tenantId,
            task_id: task1.task_id,
            item_name: 'Schedule kickoff meeting',
            description: 'Set up initial meeting',
            order_number: 2,
            completed: false
          },
          {
            tenant: context.tenantId,
            task_id: task2.task_id,
            item_name: 'Create wireframes',
            description: 'Design UI wireframes',
            order_number: 1,
            completed: false
          }
        ]);

      // 7. Create template from project
      const templateId = await createTemplateFromProject(project.project_id, {
        template_name: 'Complete Project Template',
        description: 'Template with full project structure',
        category: 'Software Development'
      });

      expect(templateId).toBeDefined();
      expect(typeof templateId).toBe('string');

      // 8. Verify template was created
      const template = await context.db('project_templates')
        .where({ template_id: templateId, tenant: context.tenantId })
        .first();

      expect(template).toBeDefined();
      expect(template.template_name).toBe('Complete Project Template');
      expect(template.description).toBe('Template with full project structure');
      expect(template.category).toBe('Software Development');
      expect(template.use_count).toBe(0);

      // 9. Verify phases were copied
      const templatePhases = await context.db('project_template_phases')
        .where({ template_id: templateId, tenant: context.tenantId })
        .orderBy('order_key');

      expect(templatePhases).toHaveLength(2);
      expect(templatePhases[0].phase_name).toBe('Phase 1: Planning');
      expect(templatePhases[0].description).toBe('Initial planning phase');
      expect(templatePhases[1].phase_name).toBe('Phase 2: Execution');

      // 10. Verify tasks were copied
      const phaseIds = templatePhases.map(p => p.template_phase_id);
      const templateTasks = await context.db('project_template_tasks')
        .where('tenant', context.tenantId)
        .whereIn('template_phase_id', phaseIds)
        .orderBy('order_key');

      expect(templateTasks).toHaveLength(3);
      expect(templateTasks[0].task_name).toBe('Task 1: Requirements');
      expect(templateTasks[0].estimated_hours).toBe(10);
      expect(templateTasks[1].task_name).toBe('Task 2: Design');
      expect(templateTasks[1].estimated_hours).toBe(15);
      expect(templateTasks[2].task_name).toBe('Task 3: Implementation');
      expect(templateTasks[2].estimated_hours).toBe(40);

      // 11. Verify dependencies were copied with correct remapped IDs
      const templateDeps = await context.db('project_template_dependencies')
        .where({ template_id: templateId, tenant: context.tenantId });

      expect(templateDeps).toHaveLength(2);

      // Find the dependencies by matching task names
      const dep1 = templateDeps.find(d =>
        templateTasks.find(t => t.template_task_id === d.predecessor_task_id)?.task_name === 'Task 1: Requirements' &&
        templateTasks.find(t => t.template_task_id === d.successor_task_id)?.task_name === 'Task 2: Design'
      );
      expect(dep1).toBeDefined();
      expect(dep1!.dependency_type).toBe('finish_to_start');
      expect(dep1!.lead_lag_days).toBe(0);

      const dep2 = templateDeps.find(d =>
        templateTasks.find(t => t.template_task_id === d.predecessor_task_id)?.task_name === 'Task 2: Design' &&
        templateTasks.find(t => t.template_task_id === d.successor_task_id)?.task_name === 'Task 3: Implementation'
      );
      expect(dep2).toBeDefined();
      expect(dep2!.dependency_type).toBe('finish_to_start');
      expect(dep2!.lead_lag_days).toBe(2);

      // 12. Verify checklists were copied
      const taskIds = templateTasks.map(t => t.template_task_id);
      const templateChecklists = await context.db('project_template_checklist_items')
        .where('tenant', context.tenantId)
        .whereIn('template_task_id', taskIds)
        .orderBy('order_number');

      expect(templateChecklists).toHaveLength(3);

      // Check checklists for first task
      const task1Checklists = templateChecklists.filter(c =>
        c.template_task_id === templateTasks[0].template_task_id
      );
      expect(task1Checklists).toHaveLength(2);
      expect(task1Checklists[0].item_name).toBe('Review stakeholder list');
      expect(task1Checklists[1].item_name).toBe('Schedule kickoff meeting');

      // Check checklist for second task
      const task2Checklists = templateChecklists.filter(c =>
        c.template_task_id === templateTasks[1].template_task_id
      );
      expect(task2Checklists).toHaveLength(1);
      expect(task2Checklists[0].item_name).toBe('Create wireframes');

      // 13. Verify status mappings were copied
      const templateStatusMappings = await context.db('project_template_status_mappings')
        .where({ template_id: templateId, tenant: context.tenantId })
        .orderBy('display_order');

      expect(templateStatusMappings).toHaveLength(1);
      expect(templateStatusMappings[0].custom_status_name).toBe('Not Started');
      expect(templateStatusMappings[0].display_order).toBe(1);
    });
  });

  describe('Applying template and verifying complete project structure', () => {
    it('should create a complete project from template with correct structure', async () => {
      // 1. Create a template with full structure
      const [template] = await context.db('project_templates')
        .insert({
          tenant: context.tenantId,
          template_name: 'Software Development Template',
          description: 'Standard software development workflow',
          category: 'Development',
          created_by: context.userId,
          use_count: 0
        })
        .returning('*');

      // 2. Create template phases
      const [templatePhase1] = await context.db('project_template_phases')
        .insert({
          tenant: context.tenantId,
          template_id: template.template_id,
          phase_name: 'Discovery',
          description: 'Discovery and planning',
          start_offset_days: 0,
          duration_days: 5,
          order_key: 'a0'
        })
        .returning('*');

      const [templatePhase2] = await context.db('project_template_phases')
        .insert({
          tenant: context.tenantId,
          template_id: template.template_id,
          phase_name: 'Development',
          description: 'Build the solution',
          start_offset_days: 5,
          duration_days: 15,
          order_key: 'a1'
        })
        .returning('*');

      // 3. Create template tasks
      const [templateTask1] = await context.db('project_template_tasks')
        .insert({
          tenant: context.tenantId,
          template_phase_id: templatePhase1.template_phase_id,
          task_name: 'Analyze Requirements',
          description: 'Document all requirements',
          estimated_hours: 8,
          order_key: 'a0',
          task_type_key: 'task'
        })
        .returning('*');

      const [templateTask2] = await context.db('project_template_tasks')
        .insert({
          tenant: context.tenantId,
          template_phase_id: templatePhase1.template_phase_id,
          task_name: 'Create Technical Spec',
          description: 'Write technical specification',
          estimated_hours: 12,
          order_key: 'a1',
          task_type_key: 'task'
        })
        .returning('*');

      const [templateTask3] = await context.db('project_template_tasks')
        .insert({
          tenant: context.tenantId,
          template_phase_id: templatePhase2.template_phase_id,
          task_name: 'Develop Features',
          description: 'Implement core features',
          estimated_hours: 80,
          order_key: 'a0',
          task_type_key: 'task'
        })
        .returning('*');

      // 4. Create template dependencies
      await context.db('project_template_dependencies')
        .insert([
          {
            tenant: context.tenantId,
            template_id: template.template_id,
            predecessor_task_id: templateTask1.template_task_id,
            successor_task_id: templateTask2.template_task_id,
            dependency_type: 'finish_to_start',
            lead_lag_days: 1
          },
          {
            tenant: context.tenantId,
            template_id: template.template_id,
            predecessor_task_id: templateTask2.template_task_id,
            successor_task_id: templateTask3.template_task_id,
            dependency_type: 'finish_to_start',
            lead_lag_days: 0
          }
        ]);

      // 5. Create template checklists
      await context.db('project_template_checklist_items')
        .insert([
          {
            tenant: context.tenantId,
            template_task_id: templateTask1.template_task_id,
            item_name: 'Interview stakeholders',
            order_number: 1
          },
          {
            tenant: context.tenantId,
            template_task_id: templateTask1.template_task_id,
            item_name: 'Document findings',
            order_number: 2
          }
        ]);

      // 6. Create template status mappings
      await context.db('project_template_status_mappings')
        .insert([
          {
            tenant: context.tenantId,
            template_id: template.template_id,
            status_id: null,
            custom_status_name: 'To Do',
            display_order: 1
          },
          {
            tenant: context.tenantId,
            template_id: template.template_id,
            status_id: null,
            custom_status_name: 'Done',
            display_order: 2
          }
        ]);

      // 7. Apply template to create new project
      const projectId = await applyTemplate(template.template_id, {
        project_name: 'New Client Project',
        client_id: context.clientId,
        start_date: '2025-01-01'
      });

      expect(projectId).toBeDefined();
      expect(typeof projectId).toBe('string');

      // 8. Verify project was created
      const project = await context.db('projects')
        .where({ project_id: projectId, tenant: context.tenantId })
        .first();

      expect(project).toBeDefined();
      expect(project.project_name).toBe('New Client Project');
      expect(project.client_id).toBe(context.clientId);

      // 9. Verify phases were created
      const phases = await context.db('project_phases')
        .where({ project_id: projectId, tenant: context.tenantId })
        .orderBy('order_key');

      expect(phases).toHaveLength(2);
      expect(phases[0].phase_name).toBe('Discovery');
      expect(phases[0].wbs_code).toMatch(/^\d+\.\d+$/); // Format like "1.1"

      // 10. Verify tasks were created
      const phaseIds = phases.map(p => p.phase_id);
      const tasks = await context.db('project_tasks')
        .where('tenant', context.tenantId)
        .whereIn('phase_id', phaseIds)
        .orderBy(['phase_id', 'order_key']);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].task_name).toBe('Analyze Requirements');
      expect(tasks[0].estimated_hours).toBe(8);
      expect(tasks[0].wbs_code).toMatch(/^\d+\.\d+\.\d+$/); // Format like "1.1.1"

      // 11. Verify dependencies were created with remapped IDs
      const taskIds = tasks.map(t => t.task_id);
      const dependencies = await context.db('project_task_dependencies')
        .where('tenant', context.tenantId)
        .whereIn('predecessor_task_id', taskIds);

      expect(dependencies).toHaveLength(2);

      // 12. Verify template usage was incremented
      const updatedTemplate = await context.db('project_templates')
        .where({ template_id: template.template_id, tenant: context.tenantId })
        .first();

      expect(updatedTemplate.use_count).toBe(1);
      expect(updatedTemplate.last_used_at).toBeDefined();
    });
  });

  describe('WBS code generation', () => {
    it('should generate correct WBS codes for phases and tasks', async () => {
      // 1. Create template
      const [template] = await context.db('project_templates')
        .insert({
          tenant: context.tenantId,
          template_name: 'WBS Test Template',
          created_by: context.userId,
          use_count: 0
        })
        .returning('*');

      // 2. Create multiple phases
      const [phase1] = await context.db('project_template_phases')
        .insert({
          tenant: context.tenantId,
          template_id: template.template_id,
          phase_name: 'Phase 1',
          start_offset_days: 0,
          order_key: 'a0'
        })
        .returning('*');

      const [phase2] = await context.db('project_template_phases')
        .insert({
          tenant: context.tenantId,
          template_id: template.template_id,
          phase_name: 'Phase 2',
          start_offset_days: 0,
          order_key: 'a1'
        })
        .returning('*');

      // 3. Create multiple tasks per phase
      await context.db('project_template_tasks')
        .insert([
          {
            tenant: context.tenantId,
            template_phase_id: phase1.template_phase_id,
            task_name: 'Task 1.1',
            order_key: 'a0'
          },
          {
            tenant: context.tenantId,
            template_phase_id: phase1.template_phase_id,
            task_name: 'Task 1.2',
            order_key: 'a1'
          },
          {
            tenant: context.tenantId,
            template_phase_id: phase2.template_phase_id,
            task_name: 'Task 2.1',
            order_key: 'a0'
          }
        ]);

      // 4. Apply template
      const projectId = await applyTemplate(template.template_id, {
        project_name: 'WBS Test Project',
        client_id: context.clientId
      });

      // 5. Verify WBS codes
      const project = await context.db('projects')
        .where({ project_id: projectId, tenant: context.tenantId })
        .first();

      expect(project.wbs_code).toMatch(/^\d+$/); // Project: "1", "2", etc.

      const phases = await context.db('project_phases')
        .where({ project_id: projectId, tenant: context.tenantId })
        .orderBy('order_key');

      expect(phases[0].wbs_code).toBe(`${project.wbs_code}.1`);
      expect(phases[1].wbs_code).toBe(`${project.wbs_code}.2`);

      const tasks = await context.db('project_tasks')
        .where('tenant', context.tenantId)
        .whereIn('phase_id', phases.map(p => p.phase_id))
        .orderBy(['phase_id', 'order_key']);

      expect(tasks[0].wbs_code).toBe(`${phases[0].wbs_code}.1`); // e.g., "1.1.1"
      expect(tasks[1].wbs_code).toBe(`${phases[0].wbs_code}.2`); // e.g., "1.1.2"
      expect(tasks[2].wbs_code).toBe(`${phases[1].wbs_code}.1`); // e.g., "1.2.1"
    });
  });

  describe('Status mapping copying', () => {
    it('should copy custom status mappings from template to project', async () => {
      // 1. Create template
      const [template] = await context.db('project_templates')
        .insert({
          tenant: context.tenantId,
          template_name: 'Status Mapping Test',
          created_by: context.userId,
          use_count: 0
        })
        .returning('*');

      // 2. Create custom status mappings
      await context.db('project_template_status_mappings')
        .insert([
          {
            tenant: context.tenantId,
            template_id: template.template_id,
            status_id: null,
            custom_status_name: 'Backlog',
            display_order: 1
          },
          {
            tenant: context.tenantId,
            template_id: template.template_id,
            status_id: null,
            custom_status_name: 'In Review',
            display_order: 2
          },
          {
            tenant: context.tenantId,
            template_id: template.template_id,
            status_id: null,
            custom_status_name: 'Completed',
            display_order: 3
          }
        ]);

      // 3. Create a simple phase
      await context.db('project_template_phases')
        .insert({
          tenant: context.tenantId,
          template_id: template.template_id,
          phase_name: 'Test Phase',
          start_offset_days: 0,
          order_key: 'a0'
        });

      // 4. Apply template
      const projectId = await applyTemplate(template.template_id, {
        project_name: 'Status Test Project',
        client_id: context.clientId
      });

      // 5. Verify status mappings were copied
      const projectStatusMappings = await context.db('project_status_mappings')
        .where({ project_id: projectId, tenant: context.tenantId })
        .orderBy('display_order');

      expect(projectStatusMappings).toHaveLength(3);
      expect(projectStatusMappings[0].custom_name).toBe('Backlog');
      expect(projectStatusMappings[0].display_order).toBe(1);
      expect(projectStatusMappings[0].is_visible).toBe(true);
    });
  });

  describe('Template usage statistics', () => {
    it('should track template usage count and last used date', async () => {
      // 1. Create template
      const [template] = await context.db('project_templates')
        .insert({
          tenant: context.tenantId,
          template_name: 'Usage Tracking Template',
          created_by: context.userId,
          use_count: 0,
          last_used_at: null
        })
        .returning('*');

      // 2. Create simple structure
      await context.db('project_template_phases')
        .insert({
          tenant: context.tenantId,
          template_id: template.template_id,
          phase_name: 'Phase',
          start_offset_days: 0,
          order_key: 'a0'
        });

      expect(template.use_count).toBe(0);
      expect(template.last_used_at).toBeNull();

      // 3. Apply template first time
      await applyTemplate(template.template_id, {
        project_name: 'Project 1',
        client_id: context.clientId
      });

      let updatedTemplate = await context.db('project_templates')
        .where({ template_id: template.template_id, tenant: context.tenantId })
        .first();

      expect(updatedTemplate.use_count).toBe(1);
      expect(updatedTemplate.last_used_at).toBeDefined();

      // 4. Apply template second time
      await applyTemplate(template.template_id, {
        project_name: 'Project 2',
        client_id: context.clientId
      });

      updatedTemplate = await context.db('project_templates')
        .where({ template_id: template.template_id, tenant: context.tenantId })
        .first();

      expect(updatedTemplate.use_count).toBe(2);
    });

    it('should return templates with correct usage statistics', async () => {
      // 1. Create multiple templates with different usage
      await context.db('project_templates')
        .insert([
          {
            tenant: context.tenantId,
            template_name: 'Popular Template',
            created_by: context.userId,
            use_count: 10,
            last_used_at: new Date('2025-01-15')
          },
          {
            tenant: context.tenantId,
            template_name: 'Unused Template',
            created_by: context.userId,
            use_count: 0,
            last_used_at: null
          },
          {
            tenant: context.tenantId,
            template_name: 'Recently Used Template',
            created_by: context.userId,
            use_count: 5,
            last_used_at: new Date()
          }
        ]);

      // 2. Retrieve templates
      const templates = await getTemplates();

      expect(templates).toHaveLength(3);

      // 3. Verify usage statistics
      const popular = templates.find(t => t.template_name === 'Popular Template');
      expect(popular?.use_count).toBe(10);

      const unused = templates.find(t => t.template_name === 'Unused Template');
      expect(unused?.use_count).toBe(0);

      const recent = templates.find(t => t.template_name === 'Recently Used Template');
      expect(recent?.use_count).toBe(5);
    });
  });

  describe('Template retrieval with details', () => {
    it('should retrieve template with all related data', async () => {
      // 1. Create complete template structure
      const [template] = await context.db('project_templates')
        .insert({
          tenant: context.tenantId,
          template_name: 'Complete Template',
          description: 'Full featured template',
          category: 'Testing',
          created_by: context.userId,
          use_count: 0
        })
        .returning('*');

      const [phase] = await context.db('project_template_phases')
        .insert({
          tenant: context.tenantId,
          template_id: template.template_id,
          phase_name: 'Test Phase',
          description: 'Phase description',
          start_offset_days: 0,
          order_key: 'a0'
        })
        .returning('*');

      const [task] = await context.db('project_template_tasks')
        .insert({
          tenant: context.tenantId,
          template_phase_id: phase.template_phase_id,
          task_name: 'Test Task',
          description: 'Task description',
          estimated_hours: 10,
          order_key: 'a0'
        })
        .returning('*');

      await context.db('project_template_checklist_items')
        .insert({
          tenant: context.tenantId,
          template_task_id: task.template_task_id,
          item_name: 'Checklist item',
          order_number: 1
        });

      await context.db('project_template_status_mappings')
        .insert({
          tenant: context.tenantId,
          template_id: template.template_id,
          custom_status_name: 'Custom Status',
          display_order: 1
        });

      // 2. Retrieve template with details
      const templateWithDetails = await getTemplateWithDetails(template.template_id);

      expect(templateWithDetails).toBeDefined();
      expect(templateWithDetails!.template_name).toBe('Complete Template');
      expect(templateWithDetails!.description).toBe('Full featured template');
      expect(templateWithDetails!.category).toBe('Testing');

      expect(templateWithDetails!.phases).toHaveLength(1);
      expect(templateWithDetails!.phases![0].phase_name).toBe('Test Phase');

      expect(templateWithDetails!.tasks).toHaveLength(1);
      expect(templateWithDetails!.tasks![0].task_name).toBe('Test Task');

      expect(templateWithDetails!.checklist_items).toHaveLength(1);
      expect(templateWithDetails!.checklist_items![0].item_name).toBe('Checklist item');

      expect(templateWithDetails!.status_mappings).toHaveLength(1);
      expect(templateWithDetails!.status_mappings![0].custom_status_name).toBe('Custom Status');
    });
  });
});
