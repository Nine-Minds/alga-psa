import { describe, it, expect } from 'vitest';
import { buildTaskTimeEntryContext } from './timeEntryContext';

describe('task time entry context helper', () => {
  it('builds project task context with project/phase/task and service', () => {
    const context = buildTaskTimeEntryContext({
      taskId: 'task-1',
      taskName: 'Design UI',
      projectName: 'Project Alpha',
      phaseName: 'Phase 1',
      serviceId: 'service-1',
      serviceName: 'Design',
    });

    expect(context.workItemId).toBe('task-1');
    expect(context.workItemType).toBe('project_task');
    expect(context.projectName).toBe('Project Alpha');
    expect(context.phaseName).toBe('Phase 1');
    expect(context.taskName).toBe('Design UI');
    expect(context.serviceId).toBe('service-1');
    expect(context.serviceName).toBe('Design');
  });
});
