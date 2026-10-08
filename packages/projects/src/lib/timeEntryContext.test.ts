import { describe, it, expect } from 'vitest';
import { applicableServiceDefault, buildTaskTimeEntryContext } from './timeEntryContext';

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

describe('applicableServiceDefault', () => {
  it('keeps an hourly phase default', () => {
    expect(applicableServiceDefault({
      serviceId: 'service-2',
      serviceName: 'Phase Service',
      billingMethod: 'hourly',
      source: 'phase',
    })).toEqual({ serviceId: 'service-2', serviceName: 'Phase Service', source: 'phase' });
  });

  it('keeps an hourly project default when the phase sets none', () => {
    expect(applicableServiceDefault({
      serviceId: 'service-3',
      serviceName: 'Project Service',
      billingMethod: 'hourly',
      source: 'project',
    })).toEqual({ serviceId: 'service-3', serviceName: 'Project Service', source: 'project' });
  });

  it('drops a default the time entry form cannot hold', () => {
    expect(applicableServiceDefault({
      serviceId: 'service-4',
      serviceName: 'Fixed Retainer',
      billingMethod: 'fixed',
      source: 'project',
    })).toBeNull();
  });

  it('judges eligibility without a service catalog lookup', () => {
    // billingMethod rides along on the resolution, so a default survives even
    // when the form's catalog list has not loaded yet.
    expect(applicableServiceDefault({
      serviceId: 'service-5',
      serviceName: null,
      billingMethod: 'hourly',
      source: 'project',
    })).toEqual({ serviceId: 'service-5', serviceName: null, source: 'project' });
  });

  it('returns null when no level sets a default', () => {
    expect(applicableServiceDefault({
      serviceId: null,
      serviceName: null,
      billingMethod: null,
      source: null,
    })).toBeNull();
    expect(applicableServiceDefault(null)).toBeNull();
  });
});
