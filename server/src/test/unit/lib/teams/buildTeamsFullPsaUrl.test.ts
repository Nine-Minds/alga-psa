import { describe, expect, it } from 'vitest';
import { buildTeamsFullPsaUrl } from 'server/src/lib/teams/buildTeamsFullPsaUrl';

describe('buildTeamsFullPsaUrl', () => {
  it('T203: returns full PSA web paths for deep-linked ticket, project-task, approval, time-entry, and contact destinations', () => {
    expect(buildTeamsFullPsaUrl({ type: 'ticket', ticketId: 'ticket-123' })).toBe('/msp/tickets/ticket-123');
    expect(buildTeamsFullPsaUrl({ type: 'project_task', projectId: 'project-44', taskId: 'task-88' })).toBe(
      '/msp/projects/project-44?taskId=task-88'
    );
    expect(buildTeamsFullPsaUrl({ type: 'approval', approvalId: 'approval-2' })).toBe(
      '/msp/time-sheet-approvals?approvalId=approval-2'
    );
    expect(buildTeamsFullPsaUrl({ type: 'time_entry', entryId: 'entry-9' })).toBe(
      '/msp/time-entry?entryId=entry-9'
    );
    expect(buildTeamsFullPsaUrl({ type: 'contact', contactId: 'contact-5', clientId: 'client-9' })).toBe(
      '/msp/contacts/contact-5'
    );
  });

  it('T204: omits the full-PSA handoff for the default my-work landing destination', () => {
    expect(buildTeamsFullPsaUrl({ type: 'my_work' })).toBeNull();
  });
});
