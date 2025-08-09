import { faker } from '@faker-js/faker';

/**
 * Create test project data
 */
export function createProjectTestData(overrides: Partial<any> = {}) {
  const startDate = faker.date.future({ years: 0.5 });
  const endDate = faker.date.future({ years: 1, refDate: startDate });
  
  return {
    project_name: overrides.project_name || faker.company.catchPhrase(),
    company_id: overrides.company_id || faker.string.uuid(),
    description: overrides.description || faker.lorem.paragraph(),
    start_date: overrides.start_date || startDate.toISOString(),
    end_date: overrides.end_date || endDate.toISOString(),
    // Don't set status - let the API use the default status_id from the statuses table
    ...overrides
  };
}

/**
 * Create test project phase data
 */
export function createProjectPhaseData(projectId: string, overrides: Partial<any> = {}) {
  const startDate = faker.date.future({ years: 0.25 });
  const endDate = faker.date.future({ years: 0.5, refDate: startDate });
  
  return {
    project_id: projectId,
    phase_name: overrides.phase_name || faker.helpers.arrayElement(['Discovery', 'Design', 'Development', 'Testing', 'Deployment']),
    description: overrides.description || faker.lorem.sentence(),
    start_date: overrides.start_date || startDate.toISOString(),
    end_date: overrides.end_date || endDate.toISOString(),
    status: overrides.status || faker.helpers.arrayElement(['pending', 'in_progress', 'completed']),
    order_index: overrides.order_index || faker.number.int({ min: 1, max: 10 }),
    ...overrides
  };
}

/**
 * Create test project task data
 */
export function createProjectTaskData(projectId: string, overrides: Partial<any> = {}) {
  return {
    project_id: projectId,
    task_name: overrides.task_name || faker.hacker.phrase(),
    description: overrides.description || faker.lorem.paragraph(),
    status: overrides.status || faker.helpers.arrayElement(['todo', 'in_progress', 'review', 'done']),
    priority: overrides.priority || faker.helpers.arrayElement(['low', 'medium', 'high']),
    assigned_to: overrides.assigned_to || faker.string.uuid(),
    due_date: overrides.due_date || faker.date.future({ years: 0.1 }).toISOString(),
    estimated_hours: overrides.estimated_hours || faker.number.int({ min: 1, max: 40 }),
    actual_hours: overrides.actual_hours || faker.number.int({ min: 0, max: 50 }),
    completion_percentage: overrides.completion_percentage || faker.number.int({ min: 0, max: 100 }),
    tags: overrides.tags || [faker.word.noun()],
    ...overrides
  };
}

/**
 * Create test task checklist item data
 */
export function createTaskChecklistItemData(taskId: string, overrides: Partial<any> = {}) {
  return {
    task_id: taskId,
    item_text: overrides.item_text || faker.lorem.sentence(),
    is_completed: overrides.is_completed ?? faker.datatype.boolean(),
    order_index: overrides.order_index || faker.number.int({ min: 1, max: 10 }),
    ...overrides
  };
}

/**
 * Create multiple test projects
 */
export function createMultipleProjects(count: number, companyId: string) {
  return Array.from({ length: count }, () => createProjectTestData({ company_id: companyId }));
}

/**
 * Create project with phases
 */
export function createProjectWithPhases(companyId: string, phaseCount: number = 3) {
  const project = createProjectTestData({ company_id: companyId });
  const phases = Array.from({ length: phaseCount }, (_, index) => 
    createProjectPhaseData(faker.string.uuid(), { order_index: index + 1 })
  );
  
  return { project, phases };
}

/**
 * Create project with tasks
 */
export function createProjectWithTasks(companyId: string, taskCount: number = 5) {
  const project = createProjectTestData({ company_id: companyId });
  const tasks = Array.from({ length: taskCount }, () => 
    createProjectTaskData(faker.string.uuid())
  );
  
  return { project, tasks };
}

/**
 * Create project by type
 */
export function createProjectByType(type: string, companyId: string, overrides: Partial<any> = {}) {
  const typeDefaults: Record<string, any> = {
    development: {
      project_type: 'development',
      estimated_hours: faker.number.int({ min: 500, max: 2000 }),
      tags: ['software', 'development']
    },
    consulting: {
      project_type: 'consulting',
      billing_rate: faker.number.float({ min: 200, max: 500, precision: 0.01 }),
      tags: ['consulting', 'advisory']
    },
    research: {
      project_type: 'research',
      is_billable: false,
      tags: ['research', 'innovation']
    },
    maintenance: {
      project_type: 'maintenance',
      priority: 'high',
      tags: ['maintenance', 'support']
    }
  };
  
  return createProjectTestData({
    company_id: companyId,
    ...typeDefaults[type] || {},
    ...overrides
  });
}