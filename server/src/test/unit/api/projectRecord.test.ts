import { describe, expect, it } from 'vitest';
import { projectRecord } from '@/lib/api/controllers/projectRecord';
import { projectApiRecord } from '@/lib/api/controllers/apiRecordProjection';
import { buildAuthorizationAwarePage } from '@alga-psa/authorization/pagination';

const project = {
  project_id: 'project-1',
  project_name: 'Migration',
  description: 'Confidential scope',
  budgeted_hours: 80,
  client_id: 'client-1',
  client_name: 'Northwind',
  status: 'status-1',
  status_name: 'Active',
};

describe('projectRecord REST projection', () => {
  it('preserves unrestricted records and removes canonical and relation-qualified hidden fields', () => {
    expect(projectRecord(project, [])).toEqual(project);
    const projected = projectRecord(project, ['fields.description', 'projects.budgeted_hours']);
    expect(projected).not.toHaveProperty('description');
    expect(projected).not.toHaveProperty('budgeted_hours');
    expect(projected).toMatchObject({ project_id: project.project_id, project_name: project.project_name });
  });

  it('preserves Date and other scalar objects through JSON serialization', () => {
    const timestamp = new Date('2026-01-02T03:04:05.000Z');
    const projected = projectRecord({ ...project, created_at: timestamp, metadata: new URL('https://example.test/path') }, []);
    expect(projected?.created_at).toBe(timestamp);
    expect(JSON.parse(JSON.stringify(projected)).created_at).toBe('2026-01-02T03:04:05.000Z');
    expect(JSON.parse(JSON.stringify(projected)).metadata).toBe('https://example.test/path');
  });

  it('composes canonical aliases with default aliases for every project derived field', () => {
    const aliases: Array<[string, string, string]> = [
      ['client_name', 'projects.client_name', 'Secret client'],
      ['client_name', 'values.client_name', 'Secret client'],
      ['status_name', 'projects.status_name', 'Secret status'],
      ['status_name', 'values.status_name', 'Secret status'],
      ['assigned_user_name', 'projects.assigned_user_name', 'Secret assignee'],
      ['assigned_user_name', 'values.assigned_user_name', 'Secret assignee'],
      ['contact_name', 'projects.contact_name', 'Secret contact'],
      ['contact_name', 'values.contact_name', 'Secret contact'],
      ['projectName', 'projects.projectName', 'Secret project'],
      ['projectName', 'values.projectName', 'Secret project'],
    ];
    for (const [field, alias, value] of aliases) {
      const result = projectRecord({ ...project, [field]: value }, [alias]);
      expect(result).not.toHaveProperty(field);
    }
  });

  it('hides ticket-derived values when their source identifiers are hidden', () => {
    const ticket = {
      ticket_id: 't1', status_id: 's1', status_name: 'Open', status_is_closed: false,
      priority_id: 'p1', priority_name: 'Urgent', category_id: 'c1', category_name: 'Support',
      subcategory_id: 'sc1', subcategory_name: 'Access', board_id: 'b1', board_name: 'Helpdesk',
      assigned_to: 'u1', assigned_to_name: 'Assigned User', entered_by: 'u2', entered_by_name: 'Creator',
    };
    for (const [source, derived] of [
      ['tickets.status_id', 'status_is_closed'], ['values.status_id', 'status_name'],
      ['tickets.priority_id', 'priority_name'], ['values.category_id', 'category_name'],
      ['tickets.subcategory_id', 'subcategory_name'], ['values.board_id', 'board_name'],
      ['tickets.assigned_to', 'assigned_to_name'], ['values.entered_by', 'entered_by_name'],
    ]) {
      const result = projectApiRecord('ticket', ticket, [source]);
      expect(result).not.toHaveProperty(derived);
    }
  });

  it('hides derived names when their source identifiers are hidden', () => {
    for (const source of ['projects.client_id', 'values.client_id']) {
      const result = projectRecord(project, [source]);
      expect(result).not.toHaveProperty('client_id');
      expect(result).not.toHaveProperty('client_name');
    }
    expect(projectRecord(project, ['statuses.name'])).toEqual(expect.not.objectContaining({ status_name: expect.anything() }));
    for (const source of ['projects.assigned_to', 'projects.contact_name_id']) {
      const result = projectRecord({ ...project, assigned_to: 'u1', assigned_user_name: 'Alex', contact_name_id: 'c1', contact_name: 'Kim' }, [source]);
      expect(result).not.toHaveProperty(source.endsWith('assigned_to') ? 'assigned_to' : 'contact_name_id');
      expect(result).not.toHaveProperty(source.endsWith('assigned_to') ? 'assigned_user_name' : 'contact_name');
    }
    expect(projectRecord({ ...project, projectName: 'Derived project name' }, ['projectName'])).not.toHaveProperty('projectName');
  });

  it('suppresses records when an aliased identifier source is hidden', () => {
    expect(projectRecord({ ...project, values: { project_id: 'project-1' } }, ['values.project_id'])).toBeNull();
    expect(projectRecord({ ...project, projectName: 'Migration' }, ['project_name'])).not.toHaveProperty('projectName');
    const nestedValues = projectRecord({ ...project, values: { client_id: 'client-1' } }, ['values.client_id']);
    expect(nestedValues).not.toHaveProperty('values');
  });

  it.each(['project', 'ticket', 'quote', 'asset'] as const)('suppresses %s records for values-qualified public identifiers', (resource) => {
    const field = resource === 'asset' ? 'asset_tag' : `${resource}_number`;
    expect(projectApiRecord(resource, { [field]: 'public-id' }, [`values.${field}`])).toBeNull();
  });

  it('suppresses rows when the project resource or identifier is hidden', () => {
    expect(projectRecord(project, ['projects'])).toBeNull();
    expect(projectRecord(project, ['fields.project_id'])).toBeNull();
  });

  it('expands direct and derived source aliases across task and phase resources', () => {
    const task = { task_id: 't1', task_name: 'Review C (merge)', estimated_hours: 80, project_name: 'Migration' };
    const phase = { phase_id: 'p1', start_date: '2026-01-01' };
    expect(projectApiRecord('task', task, [])).toEqual(task);
    for (const [restriction, hiddenField] of [
      ['project_tasks.estimated_hours', 'estimated_hours'],
      ['project_tasks.project_name', 'project_name'],
    ]) {
      const projected = projectApiRecord('task', task, [restriction]);
      expect(projected).not.toHaveProperty(hiddenField);
      expect(projected).toHaveProperty('task_name', task.task_name);
    }
    expect(projectApiRecord('phase', phase, [])).toEqual(phase);
    expect(projectApiRecord('phase', phase, ['project_phases.start_date'])).not.toHaveProperty('start_date');
  });

  it('still suppresses task records when their identifier or whole resource is hidden', () => {
    const task = { task_id: 't1', task_name: 'Review C (merge)' };
    expect(projectApiRecord('task', task, ['project_tasks.task_id'])).toBeNull();
    expect(projectApiRecord('task', task, ['project_tasks'])).toBeNull();
  });

  it('preserves project-link task names when unrelated task fields are hidden', () => {
    const link = {
      project_id: 'project-1', project_name: 'Migration', task_id: 'task-1',
      task_name: 'Review C (merge)', estimated_hours: 80,
    };
    expect(projectRecord(link, [])).toEqual(link);
    for (const [restriction, hiddenField] of [
      ['project_tasks.estimated_hours', 'estimated_hours'],
      ['project_tasks.project_name', 'project_name'],
    ]) {
      const projected = projectRecord(link, [restriction]);
      expect(projected).toHaveProperty('task_name', link.task_name);
      expect(projected).not.toHaveProperty(hiddenField);
    }
    expect(projectRecord(link, ['projects.project_id'])).toBeNull();
  });

  it.each(['tasks', 'fields.tasks', 'project_tasks'])(
    'hides project-link task names when the whole task resource alias %s is hidden',
    (restriction) => {
      const projected = projectRecord({ project_id: 'p1', task_id: 't1', task_name: 'Secret task' }, [restriction]);
      expect(projected).not.toHaveProperty('task_name');
    },
  );

  it.each(['task_name', 'fields.task_name', 'values.task_name', 'tasks.task_name', 'project_tasks.task_name'])(
    'hides project-link task names for canonical task-name restriction %s',
    (restriction) => {
      const projected = projectRecord({ project_id: 'p1', task_id: 't1', task_name: 'Secret task' }, [restriction]);
      expect(projected).not.toHaveProperty('task_name');
    },
  );

  it.each([
    'task_id', 'fields.task_id',
    'taskId', 'fields.taskId',
    'values.task_id', 'fields.values.task_id',
    'project_tasks.task_id', 'fields.project_tasks.task_id',
    'tasks.task_id', 'fields.tasks.task_id',
  ])('hides project-link task names when task identifier alias %s is hidden', (restriction) => {
    const projected = projectRecord({ project_id: 'p1', task_id: 't1', task_name: 'Secret task' }, [restriction]);
    expect(projected).not.toHaveProperty('task_name');
  });

  it('paginates and serializes only allowed projected rows', async () => {
    const page = await buildAuthorizationAwarePage<Record<string, any>>({
      page: 1,
      limit: 10,
      fetchPage: async () => ({ data: [project, { ...project, project_id: 'project-2' }], total: 2 }),
      authorizeRecord: async (row) => ({
        allowed: row.project_id === 'project-1',
        redactedFields: ['projects.description', 'budgeted_hours'],
      }),
      projectRecord: (row, redactions) => projectRecord(row, redactions),
    });

    expect(page.total).toBe(1);
    expect(JSON.parse(JSON.stringify(page.data))).toEqual([{
      project_id: 'project-1',
      project_name: 'Migration',
      client_id: 'client-1',
      client_name: 'Northwind',
      status: 'status-1',
      status_name: 'Active',
    }]);
  });
});
