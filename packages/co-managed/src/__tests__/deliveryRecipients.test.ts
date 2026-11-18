import { describe, expect, it } from 'vitest';
import { recipientsForAudience, type ThreadParticipants } from '../deliveryRecipients';

const r = (kind: any, id: string) => ({ kind, principalId: id, email: `${id}@x.test` });
const p: ThreadParticipants = {
  sponsorUsers: [r('msp_user', 'msp1')],
  sponsorTeams: [r('team', 'team1')],
  customerUsers: [r('customer_user', 'cu1')],
  requester: r('requester_contact', 'req1'),
};
const kinds = (a: any) => recipientsForAudience(a, p).map((x) => x.kind).sort();

describe('recipientsForAudience', () => {
  it('requester thread reaches requester, customer, MSP user and team', () => {
    expect(kinds('requester')).toEqual(['customer_user', 'msp_user', 'requester_contact', 'team']);
  });
  it('shared_it never reaches the requester', () => {
    expect(kinds('shared_it')).toEqual(['customer_user', 'msp_user', 'team']);
  });
  it('organization_private yields no cross-tenant or requester recipient', () => {
    expect(kinds('organization_private')).toEqual(['customer_user']);
  });
  it('dedupes by kind+principal', () => {
    const dup = { ...p, customerUsers: [r('customer_user', 'cu1'), r('customer_user', 'cu1')] };
    expect(recipientsForAudience('organization_private', dup)).toHaveLength(1);
  });
  it('unknown audience fails closed', () => {
    expect(recipientsForAudience('bogus' as any, p)).toEqual([]);
  });
});
