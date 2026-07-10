import { describe, expect, it } from 'vitest';
import { rmmRouteErrorFrom } from '@/app/api/v1/assets/[id]/rmm/rmmRouteErrors';

describe('rmmRouteErrorFrom', () => {
  it('maps expected asset and integration states to clear responses', () => {
    expect(rmmRouteErrorFrom(new Error('Asset not found'))).toEqual({
      status: 404,
      message: 'Asset not found. It may have been deleted. Please refresh and try again.',
    });

    expect(rmmRouteErrorFrom(new Error('Asset is not managed by NinjaOne'))).toEqual({
      status: 404,
      message: 'This asset is not managed by NinjaOne.',
    });

    expect(rmmRouteErrorFrom(new Error('No active NinjaOne integration found'))).toEqual({
      status: 409,
      message: 'No active NinjaOne integration is configured.',
    });
  });

  it('maps tier and reconnect requirements without handling unexpected failures', () => {
    expect(rmmRouteErrorFrom(new Error('This feature requires the Enterprise plan or higher.'))).toEqual({
      status: 403,
      message: 'Your current plan does not include RMM features.',
    });

    expect(rmmRouteErrorFrom(new Error('NinjaOne integration for tenant t1 requires reconnection'))).toEqual({
      status: 409,
      message: 'The NinjaOne integration needs to be reconnected before this action can run.',
    });

    expect(rmmRouteErrorFrom(new Error('database connection lost'))).toBeNull();
  });
});
