import { describe, expect, it } from 'vitest';

import {
  mergeEmailRecipients,
  selectEmailableUsers,
  type ResolvedWorkflowUser,
} from '../businessOperations/userRecipients';

const user = (overrides: Partial<ResolvedWorkflowUser>): ResolvedWorkflowUser => ({
  user_id: 'u1',
  email: 'u1@example.com',
  display_name: 'User One',
  user_type: 'internal',
  is_inactive: false,
  sources: ['user'],
  ...overrides,
});

describe('selectEmailableUsers', () => {
  it('emails active internal users with an address, using the display name', () => {
    expect(selectEmailableUsers([user({})])).toEqual({
      recipients: [{ user_id: 'u1', email: 'u1@example.com', name: 'User One' }],
      skipped: [],
    });
  });

  it('skips inactive, client and no-email users with a reason', () => {
    const result = selectEmailableUsers([
      user({ user_id: 'a', is_inactive: true }),
      user({ user_id: 'b', user_type: 'client' }),
      user({ user_id: 'c', email: null }),
      user({ user_id: 'd', email: '   ' }),
      user({ user_id: 'e', email: 'e@example.com' }),
    ]);
    expect(result.skipped).toEqual([
      { user_id: 'a', reason: 'inactive' },
      { user_id: 'b', reason: 'not_internal' },
      { user_id: 'c', reason: 'no_email' },
      { user_id: 'd', reason: 'no_email' },
    ]);
    expect(result.recipients.map((r) => r.user_id)).toEqual(['e']);
  });
});

describe('mergeEmailRecipients', () => {
  it('places internal recipients according to users_as', () => {
    const internal = [{ email: 'tech@example.com', name: 'Tech' }];
    expect(mergeEmailRecipients({ to: [{ email: 'c@example.com' }] }, internal, 'to').to.map((r) => r.email)).toEqual(['c@example.com', 'tech@example.com']);
    expect(mergeEmailRecipients({ to: [{ email: 'c@example.com' }] }, internal, 'cc').cc).toEqual([{ email: 'tech@example.com', name: 'Tech' }]);
    expect(mergeEmailRecipients({}, internal, 'bcc').bcc).toEqual([{ email: 'tech@example.com', name: 'Tech' }]);
  });

  it('removes duplicates case-insensitively with To > Cc > Bcc precedence and counts the final total', () => {
    const merged = mergeEmailRecipients(
      {
        to: [{ email: 'A@example.com' }],
        cc: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
        bcc: [{ email: 'B@example.com' }, { email: 'c@example.com' }],
      },
      [{ email: 'C@EXAMPLE.com', name: 'C' }],
      'bcc'
    );
    expect(merged.to.map((r) => r.email)).toEqual(['A@example.com']);
    expect(merged.cc.map((r) => r.email)).toEqual(['b@example.com']);
    expect(merged.bcc.map((r) => r.email)).toEqual(['c@example.com']);
    expect(merged.total).toBe(3);
  });

  it('does not repeat a technician whose address is already a literal To', () => {
    const merged = mergeEmailRecipients({ to: [{ email: 'tech@example.com' }] }, [{ email: 'TECH@example.com' }], 'cc');
    expect(merged.cc).toEqual([]);
    expect(merged.total).toBe(1);
  });
});
