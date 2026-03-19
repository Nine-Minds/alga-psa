import { describe, expect, it } from 'vitest';
import { buildTeamsFullPsaUrl } from '../../../../../../ee/server/src/lib/teams/buildTeamsFullPsaUrl';

describe('buildTeamsFullPsaUrl', () => {
  it('T203/T209: returns relative internal MSP paths for deep-linked destinations so Teams can reuse existing PSA UI composition without leaking an external origin or auth token', () => {
    const urls = [
      buildTeamsFullPsaUrl({ type: 'ticket', ticketId: 'ticket-123' }),
      buildTeamsFullPsaUrl({ type: 'project_task', projectId: 'project-44', taskId: 'task-88' }),
      buildTeamsFullPsaUrl({ type: 'approval', approvalId: 'approval-2' }),
      buildTeamsFullPsaUrl({ type: 'time_entry', entryId: 'entry-9' }),
      buildTeamsFullPsaUrl({ type: 'contact', contactId: 'contact-5', clientId: 'client-9' }),
    ];

    expect(urls).toEqual([
      '/msp/tickets/ticket-123',
      '/msp/projects/project-44?taskId=task-88',
      '/msp/time-sheet-approvals?approvalId=approval-2',
      '/msp/time-entry?entryId=entry-9',
      '/msp/contacts/contact-5',
    ]);

    urls.forEach((url) => {
      expect(url).toMatch(/^\/msp\//);
      expect(url).not.toMatch(/^https?:\/\//);
      expect(url).not.toContain('callbackUrl=');
      expect(url).not.toContain('token=');
    });
  });

  it('T204/T210: omits the full-PSA handoff for the default my-work landing destination so unsupported or fallback states stay on the safe Teams shell', () => {
    expect(buildTeamsFullPsaUrl({ type: 'my_work' })).toBeNull();
  });
});
