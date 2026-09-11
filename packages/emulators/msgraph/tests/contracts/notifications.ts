import { z } from 'zod';

// Independently sourced Microsoft Graph v1.0 changeNotification contract,
// reviewed 2026-09-08. This is the basic (non-encrypted) notification envelope:
// https://learn.microsoft.com/en-us/graph/api/resources/changenotification?view=graph-rest-1.0
// Resource-specific resourceData and lifecycle notifications require separate checks.
export const changeNotifications = z.object({
  value: z.array(z.object({
    subscriptionId: z.string().uuid(),
    subscriptionExpirationDateTime: z.string().datetime({ offset: true }),
    tenantId: z.string().uuid(),
    changeType: z.enum(['created', 'updated', 'deleted']),
    resource: z.string().min(1),
    clientState: z.string().max(255).optional(),
  })).min(1),
});
