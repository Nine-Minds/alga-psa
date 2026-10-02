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

  it('carries the service source so the entry form can show where the default came from', () => {
    expect(buildTaskTimeEntryContext({
      taskId: 'task-1',
      taskName: 'Design UI',
      serviceId: 'service-1',
      serviceName: 'Design',
      serviceSource: 'task',
    }).serviceSource).toBe('task');

    expect(buildTaskTimeEntryContext({
      taskId: 'task-1',
      taskName: 'Design UI',
      serviceId: 'service-2',
      serviceName: 'Phase Service',
      serviceSource: 'phase',
    }).serviceSource).toBe('phase');

    expect(buildTaskTimeEntryContext({
      taskId: 'task-1',
      taskName: 'Design UI',
      serviceId: 'service-3',
      serviceName: 'Project Service',
      serviceSource: 'project',
    }).serviceSource).toBe('project');
  });

  it('leaves the source undefined when no level sets a service', () => {
    const context = buildTaskTimeEntryContext({
      taskId: 'task-1',
      taskName: 'Design UI',
      serviceId: null,
      serviceName: null,
      serviceSource: null,
    });

    expect(context.serviceId).toBeNull();
    expect(context.serviceSource).toBeUndefined();
  });
});
