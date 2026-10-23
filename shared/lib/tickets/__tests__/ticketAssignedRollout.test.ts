import { describe, expect, it } from 'vitest';
import { buildTicketTeamAssignedPayload, readAssignedTeamId } from '../ticketWorkflowEventPayloads';

// Rolling-deploy safety (alga0002106): pods still running the previous ticketEmailSubscriber cast
// `changes.assigned_team_id` to a string for a uuid query, so the key must not be emitted at all.
describe('TICKET_ASSIGNED team payload rollout safety', () => {
  const payload = buildTicketTeamAssignedPayload({ ticketId: 't1', assignedByUserId: 'u1', teamId: 'team-1' }) as Record<string, any>;

  it('never carries changes.assigned_team_id (old subscribers would crash on a non-string)', () => {
    expect(payload.changes?.assigned_team_id).toBeUndefined();
  });

  it('carries the team as top-level assignedTeamId and readAssignedTeamId reads it', () => {
    expect(payload.assignedTeamId).toBe('team-1');
    expect(readAssignedTeamId(payload)).toBe('team-1');
  });

  it('still reads the team from events emitted by earlier builds', () => {
    expect(readAssignedTeamId({ changes: { assigned_team_id: 'team-2' } })).toBe('team-2');
    expect(readAssignedTeamId({ changes: { assigned_team_id: { old: null, new: 'team-3' } } })).toBe('team-3');
  });
});
