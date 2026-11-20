import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('../../../services/tickets/teamAssignmentCore', () => {
  class TeamAssignmentError extends Error {
    constructor(readonly kind: 'ticket_not_found' | 'team_not_found' | 'team_lead_missing') {
      super(kind);
    }
  }
  return { assignTeamToTicketCore: vi.fn(), TeamAssignmentError };
});

import { applyBoardDefaultTeam } from '../boardDefaultRouting';
import { assignTeamToTicketCore, TeamAssignmentError } from '../../../services/tickets/teamAssignmentCore';

describe('applyBoardDefaultTeam', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs and skips a deleted default team without failing ticket creation', async () => {
    vi.mocked(assignTeamToTicketCore).mockRejectedValue(new TeamAssignmentError('team_not_found'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(applyBoardDefaultTeam({} as any, 'tenant', null, 'ticket', 'deleted-team', 'board'))
      .resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      'Ignoring stale board default team during ticket creation',
      expect.objectContaining({ teamId: 'deleted-team', reason: 'team_not_found' }),
    );
    warning.mockRestore();
  });
});
