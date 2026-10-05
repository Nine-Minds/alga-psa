import { describe, expect, it } from 'vitest';

import {
  buildRecordFill,
  collectChangedPayloadPaths,
  isPayloadPathEdited,
  listRecordFillTargets,
  payloadPathKey,
  toDateOnly,
} from '../workflowRunRecordFill';
import { buildBlankPayloadFromSchema, getRunDialogDateFormat } from '../workflowRunDialogUtils';

const contractEndSiblings = [
  { key: 'contractId', pickerKind: 'contract' },
  { key: 'clientId', pickerKind: 'client' },
  { key: 'clientName' },
  { key: 'endDate', isDateOnly: true },
  { key: 'occursOn', isDateOnly: true },
  { key: 'offsetDays' },
];

describe('Run dialog record fill', () => {
  const contract = {
    contract_name: 'Managed Services',
    client_id: 'client-1',
    client_name: 'Acme',
    start_date: '2026-01-01T00:00:00.000Z',
    end_date: '2026-12-31T00:00:00.000Z',
  };

  it('fills empty sibling fields by name, whatever the case style, and trims dates to YYYY-MM-DD', () => {
    expect(buildRecordFill(contract, 'contractId', contractEndSiblings, { contractId: 'c-1' })).toEqual({
      clientId: 'client-1',
      clientName: 'Acme',
      endDate: '2026-12-31',
    });
  });

  it('never overwrites what the user entered, nor the picked field', () => {
    expect(buildRecordFill(
      { ...contract, contract_id: 'other' },
      'contractId',
      contractEndSiblings,
      { contractId: 'c-1', clientId: 'client-9', clientName: '' }
    )).toEqual({ clientName: 'Acme', endDate: '2026-12-31' });
  });

  it('skips record values that are empty or are not dates for date fields', () => {
    expect(buildRecordFill({ client_name: '', end_date: 'n/a' }, 'contractId', contractEndSiblings, {})).toEqual({});
    expect(toDateOnly('2026-03-04')).toBe('2026-03-04');
    expect(toDateOnly('soon')).toBeNull();
  });
});

describe('Run dialog record fill from a ticket', () => {
  // Shaped like the ticket.assigned event payload.
  const assignedSiblings = [
    { key: 'ticketId', pickerKind: 'ticket' },
    { key: 'assignedToUserId', pickerKind: 'user' },
    { key: 'assignedByUserId', pickerKind: 'user' },
    { key: 'previousAssigneeId', pickerKind: 'user-or-team' },
    { key: 'previousAssigneeType' },
    { key: 'newAssigneeId', pickerKind: 'user-or-team' },
    { key: 'newAssigneeType' },
    { key: 'boardId', pickerKind: 'board' },
    { key: 'requesterId', pickerKind: 'contact' },
    { key: 'statusId', pickerKind: 'ticket-status' },
    { key: 'ticketNumber' },
    { key: 'assignedAt' },
  ];
  const ticketSource = {
    fields: ['ticket_number', 'board_id', 'contact_id', 'status_id', 'assigned_to', 'assigned_team_id', 'new_assignee_type'],
    kindFields: {
      board: ['board_id'],
      contact: ['contact_id'],
      'ticket-status': ['status_id'],
      user: ['assigned_to'],
      'user-or-team': ['assigned_to', 'assigned_team_id'],
    },
  };
  const ticket = {
    ticket_number: 'T-1001',
    board_id: 'board-1',
    contact_id: 'contact-1',
    status_id: 'status-1',
    assigned_to: 'user-1',
    assigned_team_id: null,
    new_assignee_type: 'user',
  };

  it('fills the assignee and other ticket fields by kind when the names differ, never other roles', () => {
    expect(buildRecordFill(ticket, 'ticketId', assignedSiblings, {}, () => false, ticketSource.kindFields)).toEqual({
      assignedToUserId: 'user-1',
      newAssigneeId: 'user-1',
      newAssigneeType: 'user',
      boardId: 'board-1',
      requesterId: 'contact-1',
      statusId: 'status-1',
      ticketNumber: 'T-1001',
    });
  });

  it('falls back to the assigned team when the ticket has no assigned user', () => {
    expect(buildRecordFill(
      { ...ticket, assigned_to: null, assigned_team_id: 'team-1', new_assignee_type: 'team' },
      'ticketId',
      assignedSiblings,
      {},
      () => false,
      ticketSource.kindFields
    )).toMatchObject({ newAssigneeId: 'team-1', newAssigneeType: 'team' });
  });

  it('lists exactly the fields a pick can fill, for the hint', () => {
    expect(listRecordFillTargets(ticketSource, 'ticketId', assignedSiblings)).toEqual([
      'assignedToUserId',
      'newAssigneeId',
      'newAssigneeType',
      'boardId',
      'requesterId',
      'statusId',
      'ticketNumber',
    ]);
  });
});

describe('Run dialog schema helpers', () => {
  it('recognizes date fields by format or by the date-only pattern', () => {
    expect(getRunDialogDateFormat({ type: 'string', format: 'date-time' })).toBe('date-time');
    expect(getRunDialogDateFormat({ type: 'string', pattern: '^(\\d{4})-(\\d{2})-(\\d{2})$' })).toBe('date');
    expect(getRunDialogDateFormat({ type: 'string' })).toBeNull();
  });

  it('starts a blank payload with only schema defaults', () => {
    expect(buildBlankPayloadFromSchema({
      type: 'object',
      properties: {
        contractId: { type: 'string' },
        offsetDays: { type: 'number', default: -30 },
        nested: { type: 'object', properties: { flag: { type: 'boolean', default: true }, name: { type: 'string' } } },
        empty: { type: 'object', properties: { name: { type: 'string' } } },
      },
    })).toEqual({ offsetDays: -30, nested: { flag: true } });
  });
});

describe('Run dialog record fill over sample values', () => {
  const client = { client_name: 'Acme Corp', status: 'active' };
  const siblings = [{ key: 'clientId', pickerKind: 'client' }, { key: 'clientName' }, { key: 'status' }];

  it('replaces prefilled sample values the user never edited', () => {
    const current = { clientId: 'client-1', clientName: 'Sample Name', status: 'status-sample' };
    expect(buildRecordFill(client, 'clientId', siblings, current, () => true)).toEqual({
      clientName: 'Acme Corp',
      status: 'active',
    });
  });

  it('keeps values the user typed', () => {
    const current = { clientId: 'client-1', clientName: 'Typed by hand', status: 'status-sample' };
    const edited = new Set([payloadPathKey(['clientName'])]);
    const fill = buildRecordFill(client, 'clientId', siblings, current, (key) => !isPayloadPathEdited(edited, [key]));
    expect(fill).toEqual({ status: 'active' });
  });
});

describe('edited payload paths', () => {
  it('lists the leaf values a change touched, in objects and lists', () => {
    expect(collectChangedPayloadPaths(
      { clientId: '', clientName: 'Sample Name', tags: ['a'], nested: { x: 1, y: 2 } },
      { clientId: 'c-1', clientName: 'Sample Name', tags: ['a', 'b'], nested: { x: 1, y: 3 } }
    )).toEqual([['clientId'], ['tags', 1], ['nested', 'y']]);
    expect(collectChangedPayloadPaths({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('treats a path as edited when it, a parent, or a child was edited', () => {
    const edited = new Set([payloadPathKey(['client']), payloadPathKey(['ticket', 'title'])]);
    expect(isPayloadPathEdited(edited, ['client', 'name'])).toBe(true);
    expect(isPayloadPathEdited(edited, ['ticket'])).toBe(true);
    expect(isPayloadPathEdited(edited, ['ticket', 'status'])).toBe(false);
    expect(isPayloadPathEdited(edited, ['clientName'])).toBe(false);
  });
});
