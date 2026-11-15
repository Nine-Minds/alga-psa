import { describe, expect, it } from 'vitest';
import {
  buildTicketDescription,
  ticketOnlyExecutionProvider,
} from '../../lib/service-requests/providers/builtins/ticketOnlyExecutionProvider';
import { convertBlockNoteToHTML } from '@alga-psa/formatting/blocknoteUtils';

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

describe('ticket-only execution provider description', () => {
  const formSchema = {
    fields: [
      { key: 'employee_name', type: 'short-text', label: 'Employee Name' },
      { key: 'department', type: 'select', label: 'Department', options: [{ label: 'Finance & Ops', value: 'fin_ops' }] },
      { key: 'needs_laptop', type: 'checkbox', label: 'Needs a laptop' },
      { key: 'start_date', type: 'date', label: 'Start Date' },
    ],
  };
  const payload = { needs_laptop: true, employee_name: 'Jane Doe', department: 'fin_ops', start_date: '' };

  it('lists answers under their display labels, in form order', () => {
    const blocks = JSON.parse(buildTicketDescription(payload, { descriptionPrefix: 'New hire' }, formSchema));
    const rows = blocks[1].content.rows.map((row: any) => row.cells.map((cell: any) => cell[0].text));

    expect(blocks[0].content[0].text).toBe('New hire');
    expect(rows).toEqual([
      ['Employee Name', 'Jane Doe'],
      ['Department', 'Finance & Ops'],
      ['Needs a laptop', 'Yes'],
      ['Start Date', '—'],
    ]);
  });

  it('renders as a filled two-column table in notification email HTML', () => {
    const html = convertBlockNoteToHTML(JSON.parse(buildTicketDescription(payload, {}, formSchema)));

    expect(html).toContain('<table>');
    expect(html).toContain('Employee Name');
    expect(html).toContain('Jane Doe');
    expect(html).not.toContain('employee_name');
  });

  it('falls back to the field key for an answer the schema does not describe', () => {
    const blocks = JSON.parse(buildTicketDescription({ legacy_field: 'kept' }, {}, { fields: [] }));

    expect(blocks[0].content.rows[0].cells.map((cell: any) => cell[0].text)).toEqual(['legacy_field', 'kept']);
  });

  it('keeps only the prefix when form responses are excluded', () => {
    const blocks = JSON.parse(
      buildTicketDescription(payload, { descriptionPrefix: 'New hire', includeFormResponsesInDescription: false }, formSchema)
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].content[0].text).toBe('New hire');
  });
});
