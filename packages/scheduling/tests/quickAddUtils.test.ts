import { describe, expect, it } from 'vitest';
import { resolveQuickAddBehavior } from '../src/components/time-management/time-entry/time-sheet/quickAddUtils';

describe('resolveQuickAddBehavior', () => {
  it('uses the existing entry service when one is available', () => {
    expect(
      resolveQuickAddBehavior(
        { service_id: 'work-item-service' } as any,
        { service_id: 'existing-entry-service' } as any,
      )
    ).toEqual({
      mode: 'save',
      serviceId: 'existing-entry-service',
    });
  });

  it('falls back to the work item service when no existing entry service exists', () => {
    expect(
      resolveQuickAddBehavior(
        { service_id: 'work-item-service' } as any,
        { service_id: '' } as any,
      )
    ).toEqual({
      mode: 'save',
      serviceId: 'work-item-service',
    });
  });

  // The work item's service_id is already the effective one (task → phase →
  // project), resolved server side, so quick add inherits phase/project
  // defaults without knowing where they came from.
  it('saves against a phase-inherited work item service', () => {
    expect(
      resolveQuickAddBehavior(
        { service_id: 'phase-service', service_source: 'phase' } as any,
        undefined,
      )
    ).toEqual({
      mode: 'save',
      serviceId: 'phase-service',
    });
  });

  it('saves against a project-inherited work item service', () => {
    expect(
      resolveQuickAddBehavior(
        { service_id: 'project-service', service_source: 'project' } as any,
        undefined,
      )
    ).toEqual({
      mode: 'save',
      serviceId: 'project-service',
    });
  });

  it('routes quick add to the full dialog when no service can be inferred', () => {
    expect(
      resolveQuickAddBehavior(
        { service_id: null } as any,
        undefined,
      )
    ).toEqual({
      mode: 'dialog',
    });
  });
});
