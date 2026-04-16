import { describe, expect, it } from 'vitest';
import { ticketOnlyExecutionProvider } from '../../lib/service-requests/providers/builtins/ticketOnlyExecutionProvider';

describe('ticket-only execution provider validation', () => {
  it('requires explicit routing before publish', () => {
    const validation = ticketOnlyExecutionProvider.validateConfig({
      titleTemplate: 'New Hire Setup: {{employee_name}}',
      includeFormResponsesInDescription: true,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toEqual([
      'Ticket routing board is required',
      'Ticket routing status is required',
      'Ticket routing priority is required',
    ]);
  });

  it('accepts custom-priority routing and ITIL routing', () => {
    expect(
      ticketOnlyExecutionProvider.validateConfig({
        boardId: 'board-123',
        statusId: 'status-123',
        priorityId: 'priority-123',
      })
    ).toMatchObject({ isValid: true, errors: [] });

    expect(
      ticketOnlyExecutionProvider.validateConfig({
        boardId: 'board-123',
        statusId: 'status-123',
        itilImpact: 2,
        itilUrgency: 4,
      })
    ).toMatchObject({ isValid: true, errors: [] });
  });

  it('rejects partial ITIL routing when no explicit priority is set', () => {
    const validation = ticketOnlyExecutionProvider.validateConfig({
      boardId: 'board-123',
      statusId: 'status-123',
      itilImpact: 2,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain(
      'Ticket routing requires both ITIL impact and urgency when priority is not set'
    );
  });
});
