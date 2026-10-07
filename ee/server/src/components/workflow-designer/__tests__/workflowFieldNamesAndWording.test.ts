import { describe, expect, it } from 'vitest';

import { formatWorkflowFieldLabel, humanizeWorkflowFieldName } from '../workflowFieldNames';
import { getWorkflowPauseWording } from '../workflowTriggerWording';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);

describe('workflow field names', () => {
  it('humanizes snake_case, camelCase and acronyms the same way', () => {
    expect(humanizeWorkflowFieldName('client_name')).toBe('Client name');
    expect(humanizeWorkflowFieldName('clientName')).toBe('Client name');
    expect(humanizeWorkflowFieldName('ticket_number')).toBe('Ticket number');
    expect(humanizeWorkflowFieldName('url')).toBe('URL');
    expect(humanizeWorkflowFieldName('contact_id')).toBe('Contact ID');
    expect(humanizeWorkflowFieldName('htmlBody')).toBe('HTML body');
  });

  it('labels a field by its description, or its humanized name, then its path', () => {
    expect(formatWorkflowFieldLabel('Requester contact', 'ticket.contact_name_id')).toBe('Requester contact (ticket.contact_name_id)');
    expect(formatWorkflowFieldLabel(undefined, 'ticket.comments[].note')).toBe('Note (ticket.comments[].note)');
  });
});

describe('pause wording follows the trigger', () => {
  it('talks about events, watched dates or schedules', () => {
    expect(getWorkflowPauseWording('event', t).pauseTitle).toMatch(/new events/);
    expect(getWorkflowPauseWording('date', t).pauseTitle).toMatch(/dates this workflow watches/);
    expect(getWorkflowPauseWording('date', t).pausedToast).not.toMatch(/events/);
    expect(getWorkflowPauseWording('manual', t).resumeTitle).toMatch(/schedules/);
  });
});
