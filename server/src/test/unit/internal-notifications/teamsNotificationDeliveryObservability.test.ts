import { describe, expect, it } from 'vitest';
import {
  mapGraphStatusToTeamsDeliveryErrorCode,
  mapTeamsNotificationSkipReasonToDeliveryErrorCode,
} from '@alga-psa/ee-microsoft-teams/lib/notifications/teamsNotificationDelivery';

describe('Teams notification delivery observability mapping', () => {
  it('maps Graph HTTP status codes to delivery error codes', () => {
    expect(mapGraphStatusToTeamsDeliveryErrorCode(401)).toBe('graph_unauthorized');
    expect(mapGraphStatusToTeamsDeliveryErrorCode(403)).toBe('graph_unauthorized');
    expect(mapGraphStatusToTeamsDeliveryErrorCode(404)).toBe('graph_not_found');
    expect(mapGraphStatusToTeamsDeliveryErrorCode(429)).toBe('graph_throttled');
    expect(mapGraphStatusToTeamsDeliveryErrorCode(500)).toBe('graph_server_error');
    expect(mapGraphStatusToTeamsDeliveryErrorCode(503)).toBe('graph_server_error');
    expect(mapGraphStatusToTeamsDeliveryErrorCode(400)).toBe('unknown');
  });

  it('maps non-Graph skip reasons to delivery error codes', () => {
    expect(mapTeamsNotificationSkipReasonToDeliveryErrorCode('addon_inactive')).toBe('addon_inactive');
    expect(mapTeamsNotificationSkipReasonToDeliveryErrorCode('integration_inactive')).toBe('integration_inactive');
    expect(mapTeamsNotificationSkipReasonToDeliveryErrorCode('missing_user_linkage')).toBe('user_not_mapped');
    expect(mapTeamsNotificationSkipReasonToDeliveryErrorCode('delivery_prerequisites_missing')).toBe('package_misconfigured');
    expect(mapTeamsNotificationSkipReasonToDeliveryErrorCode('category_disabled')).toBe('unknown');
  });
});
