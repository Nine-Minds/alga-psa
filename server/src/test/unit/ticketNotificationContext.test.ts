import { describe, expect, it, vi } from 'vitest';
import { readTicketNotificationActor, resolveTicketNotificationActorName } from '../../lib/notifications/ticketNotificationContext';

const owner = '11111111-1111-4111-8111-111111111111';
const ref = {
  ownerTenantId: owner, referenceId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333', userId: '44444444-4444-4444-8444-444444444444',
  displayName: 'Ada Lovelace', organizationName: 'Analytical MSP',
};

describe('resolveTicketNotificationActorName', () => {
  it('names a COLLABORATOR from its snapshot without a local lookup', async () => {
    const local = vi.fn(async () => 'local');
    const actor = readTicketNotificationActor({ actorType: 'COLLABORATOR', tenantId: owner, actorReference: ref }, owner);
    expect(await resolveTicketNotificationActorName(owner, actor, local)).toBe('Ada Lovelace (Analytical MSP)');
    expect(local).not.toHaveBeenCalled();
  });

  it('delegates every non-collaborator actor to the local lookup', async () => {
    const local = vi.fn(async () => 'Local Name');
    const actor = readTicketNotificationActor({ tenantId: owner }, owner, 'u1');
    expect(await resolveTicketNotificationActorName(owner, actor, local)).toBe('Local Name');
    expect(local).toHaveBeenCalledTimes(1);
  });
});
