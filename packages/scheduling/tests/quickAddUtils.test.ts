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
