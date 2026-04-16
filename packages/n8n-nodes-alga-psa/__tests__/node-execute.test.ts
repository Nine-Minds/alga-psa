import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import { AlgaPsa } from '../nodes/AlgaPsa/AlgaPsa.node';
import { createApiError, createExecuteHarness } from './testUtils';

async function executeNode(
  items: Array<Record<string, unknown>>,
  requestHandler: (options: any, index: number) => unknown,
  continueOnFail = false,
) {
  const node = new AlgaPsa();
  const harness = createExecuteHarness({
    items,
    continueOnFail,
    requestHandler,
  });

  const output = await node.execute.call(harness.context);
  return {
    output,
    requests: harness.requests,
  };
}

async function executeNodeExpectFailure(
  items: Array<Record<string, unknown>>,
  requestHandler: (options: any, index: number) => unknown = () => ({ data: {} }),
) {
  const node = new AlgaPsa();
  const harness = createExecuteHarness({
    items,
    continueOnFail: false,
    requestHandler,
  });

  try {
    await node.execute.call(harness.context);
  } catch (error) {
    return {
      error,
      requests: harness.requests,
    };
  }

  throw new Error('Expected execute to fail');
}

const baseCreateParams = {
  resource: 'ticket',
  ticketOperation: 'create',
  title: 'Example Ticket',
  client_id: { mode: 'id', value: '00000000-0000-0000-0000-000000000001' },
  board_id: { mode: 'id', value: '00000000-0000-0000-0000-000000000002' },
  status_id: { mode: 'id', value: '00000000-0000-0000-0000-000000000003' },
  priority_id: { mode: 'id', value: '00000000-0000-0000-0000-000000000004' },
};

const baseContactCreateParams = {
  resource: 'contact',
  contactOperation: 'create',
  full_name: 'Ada Lovelace',
};

describe('Node execute operations', () => {
  it('T010: Ticket Create builds POST payload with required field mappings', async () => {
    const { requests } = await executeNode(
      [
        {
          ...baseCreateParams,
          createAdditionalFields: {},
        },
      ],
      () => ({ data: { ticket_id: 'ticket-1' } }),
    );

    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('https://api.algapsa.test/api/v1/tickets');
    expect(requests[0]?.body).toMatchObject({
      title: 'Example Ticket',
      client_id: '00000000-0000-0000-0000-000000000001',
      board_id: '00000000-0000-0000-0000-000000000002',
      status_id: '00000000-0000-0000-0000-000000000003',
      priority_id: '00000000-0000-0000-0000-000000000004',
    });
  });

  it('T011: Ticket Create includes optional fields only when provided', async () => {
    const { requests } = await executeNode(
      [
        {
          ...baseCreateParams,
          createAdditionalFields: {
            url: 'https://example.test/ticket',
            tags: 'urgent,automation',
            assigned_to: '00000000-0000-0000-0000-000000000005',
          },
        },
      ],
      () => ({ data: { ticket_id: 'ticket-1' } }),
    );

    expect(requests[0]?.body).toMatchObject({
      url: 'https://example.test/ticket',
      tags: ['urgent', 'automation'],
      assigned_to: '00000000-0000-0000-0000-000000000005',
    });
    expect(requests[0]?.body).not.toHaveProperty('location_id');
    expect(requests[0]?.body).not.toHaveProperty('category_id');
  });

  it('T012: Ticket Create unwraps created ticket object from API data wrapper', async () => {
    const { output } = await executeNode(
      [
        {
          ...baseCreateParams,
          createAdditionalFields: {},
        },
      ],
      () => ({ data: { ticket_id: 'ticket-123', title: 'Created' } }),
    );

    expect(output[0][0].json).toEqual({ ticket_id: 'ticket-123', title: 'Created' });
  });

  it('T013: Ticket Get sends GET by id and rejects empty id before request', async () => {
    const success = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'get',
          ticketId: '00000000-0000-0000-0000-000000000010',
        },
      ],
      () => ({ data: { ticket_id: '00000000-0000-0000-0000-000000000010' } }),
    );

    expect(success.requests[0]?.method).toBe('GET');
    expect(success.requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/tickets/00000000-0000-0000-0000-000000000010',
    );

    await expect(
      executeNode(
        [
          {
            resource: 'ticket',
            ticketOperation: 'get',
            ticketId: '',
          },
        ],
        () => ({ data: {} }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });

  it('T014: Ticket Get returns expected ticket object', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'get',
          ticketId: '00000000-0000-0000-0000-000000000011',
        },
      ],
      () => ({ data: { ticket_id: '00000000-0000-0000-0000-000000000011', title: 'A' } }),
    );

    expect(output[0][0].json).toEqual({
      ticket_id: '00000000-0000-0000-0000-000000000011',
      title: 'A',
    });
  });

  it('T015: Ticket List serializes pagination/sort/order/filter query parameters', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'list',
          page: 2,
          limit: 50,
          sort: 'ticket_number',
          order: 'asc',
          listFilters: {
            client_id: '00000000-0000-0000-0000-000000000111',
            is_open: true,
          },
        },
      ],
      () => ({ data: [], pagination: { page: 2, total: 0 } }),
    );

    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe('https://api.algapsa.test/api/v1/tickets');
    expect(requests[0]?.qs).toMatchObject({
      page: 2,
      limit: 50,
      sort: 'ticket_number',
      order: 'asc',
      client_id: '00000000-0000-0000-0000-000000000111',
      is_open: true,
    });
  });

  it('T016: Ticket List keeps pagination metadata in node output', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'list',
          page: 1,
          limit: 25,
          sort: 'entered_at',
          order: 'desc',
          listFilters: {},
        },
      ],
      () => ({ data: [{ ticket_id: '1' }], pagination: { page: 1, total: 1, totalPages: 1 } }),
    );

    expect(output[0][0].json).toEqual({
      data: [{ ticket_id: '1' }],
      pagination: { page: 1, total: 1, totalPages: 1 },
    });
  });

  it('T047: Ticket List Comments sends GET with optional query parameters', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'listComments',
          ticketId: '00000000-0000-0000-0000-000000000112',
          commentListOptions: {
            limit: 10,
            offset: 20,
            order: 'desc',
          },
        },
      ],
      () => ({ data: [] }),
    );

    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/tickets/00000000-0000-0000-0000-000000000112/comments',
    );
    expect(requests[0]?.qs).toMatchObject({
      limit: 10,
      offset: 20,
      order: 'desc',
    });
  });

  it('T048: Ticket List Comments preserves array output from API data wrapper', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'listComments',
          ticketId: '00000000-0000-0000-0000-000000000113',
          commentListOptions: {},
        },
      ],
      () => ({
        data: [
          { comment_id: 'comment-1', comment_text: 'First' },
          { comment_id: 'comment-2', comment_text: 'Second' },
        ],
      }),
    );

    expect(output[0][0].json).toEqual({
      data: [
        { comment_id: 'comment-1', comment_text: 'First' },
        { comment_id: 'comment-2', comment_text: 'Second' },
      ],
    });
  });

  it('T017: Ticket Search serializes query and optional search filters', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'search',
          query: 'outage',
          searchLimit: 15,
          searchAdditionalFields: {
            include_closed: true,
            fields: ['title', 'ticket_number'],
            status_ids: 'status-a,status-b',
            priority_ids: 'priority-a',
            client_ids: 'client-a',
            assigned_to_ids: 'user-a,user-b',
          },
        },
      ],
      () => ({ data: [] }),
    );

    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe('https://api.algapsa.test/api/v1/tickets/search');
    expect(requests[0]?.qs).toMatchObject({
      query: 'outage',
      limit: 15,
      include_closed: true,
      fields: 'title,ticket_number',
      status_ids: 'status-a,status-b',
      priority_ids: 'priority-a',
      client_ids: 'client-a',
      assigned_to_ids: 'user-a,user-b',
    });
  });

  it('T018: Ticket Search returns result set and handles empty data array', async () => {
    const populated = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'search',
          query: 'vpn',
          searchLimit: 10,
          searchAdditionalFields: {},
        },
      ],
      () => ({ data: [{ ticket_id: 'a' }, { ticket_id: 'b' }] }),
    );

    expect(populated.output[0][0].json).toEqual({ data: [{ ticket_id: 'a' }, { ticket_id: 'b' }] });

    const empty = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'search',
          query: 'no-match',
          searchLimit: 10,
          searchAdditionalFields: {},
        },
      ],
      () => ({ data: [] }),
    );

    expect(empty.output[0][0].json).toEqual({ data: [] });
  });

  it('T019: Ticket Update sends PUT with only provided mutable fields', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'update',
          ticketId: '00000000-0000-0000-0000-000000000020',
          updateAdditionalFields: {
            title: 'Updated title',
            url: '',
            client_id: { mode: 'id', value: '00000000-0000-0000-0000-000000000021' },
            board_id: { mode: 'id', value: '' },
          },
        },
      ],
      () => ({ data: { ticket_id: '00000000-0000-0000-0000-000000000020' } }),
    );

    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.body).toEqual({
      title: 'Updated title',
      client_id: '00000000-0000-0000-0000-000000000021',
    });
  });

  it('T020: Ticket Update returns updated ticket object', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'update',
          ticketId: '00000000-0000-0000-0000-000000000022',
          updateAdditionalFields: {
            title: 'Updated',
          },
        },
      ],
      () => ({ data: { ticket_id: '00000000-0000-0000-0000-000000000022', title: 'Updated' } }),
    );

    expect(output[0][0].json).toEqual({
      ticket_id: '00000000-0000-0000-0000-000000000022',
      title: 'Updated',
    });
  });

  it('T049: Ticket Add Comment sends POST with supported payload fields only', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'addComment',
          ticketId: '00000000-0000-0000-0000-000000000114',
          commentText: 'Automation note',
          commentAdditionalFields: {
            is_internal: true,
          },
        },
      ],
      () => ({ data: { comment_id: 'comment-3' } }),
    );

    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/tickets/00000000-0000-0000-0000-000000000114/comments',
    );
    expect(requests[0]?.body).toEqual({
      comment_text: 'Automation note',
      is_internal: true,
    });
    expect(requests[0]?.body).not.toHaveProperty('time_spent');
  });

  it('T050: Ticket Add Comment unwraps the created comment object', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'addComment',
          ticketId: '00000000-0000-0000-0000-000000000115',
          commentText: 'Customer update',
          commentAdditionalFields: {},
        },
      ],
      () => ({
        data: {
          comment_id: 'comment-4',
          ticket_id: '00000000-0000-0000-0000-000000000115',
          comment_text: 'Customer update',
          is_internal: false,
        },
      }),
    );

    expect(output[0][0].json).toEqual({
      comment_id: 'comment-4',
      ticket_id: '00000000-0000-0000-0000-000000000115',
      comment_text: 'Customer update',
      is_internal: false,
    });
  });

  it('T021: Ticket Update Status sends PUT with status_id payload', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'updateStatus',
          ticketId: '00000000-0000-0000-0000-000000000023',
          status_id: { mode: 'id', value: '00000000-0000-0000-0000-000000000024' },
        },
      ],
      () => ({ data: { ticket_id: '00000000-0000-0000-0000-000000000023' } }),
    );

    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/tickets/00000000-0000-0000-0000-000000000023/status',
    );
    expect(requests[0]?.body).toEqual({
      status_id: '00000000-0000-0000-0000-000000000024',
    });
  });

  it('T022: Ticket Update Assignment sends PUT with assigned_to payload', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'updateAssignment',
          ticketId: '00000000-0000-0000-0000-000000000025',
          assignmentAction: 'assign',
          assigned_to: '00000000-0000-0000-0000-000000000026',
        },
      ],
      () => ({ data: { ticket_id: '00000000-0000-0000-0000-000000000025' } }),
    );

    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/tickets/00000000-0000-0000-0000-000000000025/assignment',
    );
    expect(requests[0]?.body).toEqual({
      assigned_to: '00000000-0000-0000-0000-000000000026',
    });
  });

  it('T023: Ticket Delete sends DELETE to ticket endpoint', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'delete',
          ticketId: '00000000-0000-0000-0000-000000000027',
        },
      ],
      () => undefined,
    );

    expect(requests[0]?.method).toBe('DELETE');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/tickets/00000000-0000-0000-0000-000000000027',
    );
  });

  it('T024: Ticket Delete converts 204-style response to success object', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'delete',
          ticketId: '00000000-0000-0000-0000-000000000028',
        },
      ],
      () => undefined,
    );

    expect(output[0][0].json).toEqual({
      success: true,
      id: '00000000-0000-0000-0000-000000000028',
      deleted: true,
    });
  });

  it('T051: Ticket comment operations reject empty or invalid ticketId before request', async () => {
    await expect(
      executeNode(
        [
          {
            resource: 'ticket',
            ticketOperation: 'listComments',
            ticketId: '',
            commentListOptions: {},
          },
        ],
        () => ({ data: [] }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);

    await expect(
      executeNode(
        [
          {
            resource: 'ticket',
            ticketOperation: 'addComment',
            ticketId: 'not-a-uuid',
            commentText: 'Hello',
            commentAdditionalFields: {},
          },
        ],
        () => ({ data: {} }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });

  it('T052: Ticket Add Comment rejects empty comment text before request', async () => {
    await expect(
      executeNode(
        [
          {
            resource: 'ticket',
            ticketOperation: 'addComment',
            ticketId: '00000000-0000-0000-0000-000000000116',
            commentText: '   ',
            commentAdditionalFields: {},
          },
        ],
        () => ({ data: {} }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });

  it('T019: contact create sends POST /api/v1/contacts', async () => {
    const { requests } = await executeNode(
      [
        {
          ...baseContactCreateParams,
          contactCreateAdditionalFields: {},
        },
      ],
      () => ({ data: { contact_name_id: 'contact-1' } }),
    );

    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('https://api.algapsa.test/api/v1/contacts');
    expect(requests[0]?.body).toEqual({ full_name: 'Ada Lovelace' });
  });

  it('T020: contact create request body includes parsed phone_numbers when provided', async () => {
    const { requests } = await executeNode(
      [
        {
          ...baseContactCreateParams,
          contactCreateAdditionalFields: {
            phone_numbers: JSON.stringify([
              {
                phone_number: '+1-206-555-0100',
                canonical_type: 'mobile',
                is_default: true,
              },
            ]),
          },
        },
      ],
      () => ({ data: { contact_name_id: 'contact-1' } }),
    );

    expect(requests[0]?.body).toMatchObject({
      full_name: 'Ada Lovelace',
      phone_numbers: [
        {
          phone_number: '+1-206-555-0100',
          canonical_type: 'mobile',
          is_default: true,
        },
      ],
    });
  });

  it('contact create request body includes primary email metadata and additional email rows when provided', async () => {
    const { requests } = await executeNode(
      [
        {
          ...baseContactCreateParams,
          contactCreateAdditionalFields: {
            email: 'ada@example.com',
            primary_email_canonical_type: 'billing',
            additional_email_addresses: JSON.stringify([
              {
                email_address: 'ada.personal@example.com',
                canonical_type: 'personal',
                display_order: 0,
              },
            ]),
          },
        },
      ],
      () => ({ data: { contact_name_id: 'contact-1' } }),
    );

    expect(requests[0]?.body).toMatchObject({
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      primary_email_canonical_type: 'billing',
      additional_email_addresses: [
        {
          email_address: 'ada.personal@example.com',
          canonical_type: 'personal',
          display_order: 0,
        },
      ],
    });
  });

  it('T021: contact create unwraps a successful data wrapper into the created contact object', async () => {
    const { output } = await executeNode(
      [
        {
          ...baseContactCreateParams,
          contactCreateAdditionalFields: {},
        },
      ],
      () => ({ data: { contact_name_id: 'contact-123', full_name: 'Ada Lovelace' } }),
    );

    expect(output[0][0].json).toEqual({
      contact_name_id: 'contact-123',
      full_name: 'Ada Lovelace',
    });
  });

  it('T022: contact get sends GET /api/v1/contacts/{id}', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'contact',
          contactOperation: 'get',
          contactId: '00000000-0000-0000-0000-000000000101',
        },
      ],
      () => ({ data: { contact_name_id: '00000000-0000-0000-0000-000000000101' } }),
    );

    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/contacts/00000000-0000-0000-0000-000000000101',
    );
  });

  it('T023: contact get returns the normalized contact object', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'contact',
          contactOperation: 'get',
          contactId: '00000000-0000-0000-0000-000000000102',
        },
      ],
      () => ({
        data: {
          contact_name_id: '00000000-0000-0000-0000-000000000102',
          full_name: 'Grace Hopper',
        },
      }),
    );

    expect(output[0][0].json).toEqual({
      contact_name_id: '00000000-0000-0000-0000-000000000102',
      full_name: 'Grace Hopper',
    });
  });

  it('T024: contact list sends GET /api/v1/contacts with selected pagination and filter query parameters', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'contact',
          contactOperation: 'list',
          contactPage: 2,
          contactLimit: 50,
          contactListFilters: {
            client_id: '00000000-0000-0000-0000-000000000103',
            search_term: 'ada',
            is_inactive: true,
          },
        },
      ],
      () => ({ data: [], pagination: { page: 2, total: 0 } }),
    );

    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe('https://api.algapsa.test/api/v1/contacts');
    expect(requests[0]?.qs).toEqual({
      page: 2,
      limit: 50,
      client_id: '00000000-0000-0000-0000-000000000103',
      search_term: 'ada',
      is_inactive: true,
    });
  });

  it('T025: contact list preserves pagination metadata in node output', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'contact',
          contactOperation: 'list',
          contactPage: 1,
          contactLimit: 25,
          contactListFilters: {},
        },
      ],
      () => ({
        data: [{ contact_name_id: 'contact-1' }],
        pagination: { page: 1, total: 1, totalPages: 1 },
      }),
    );

    expect(output[0][0].json).toEqual({
      data: [{ contact_name_id: 'contact-1' }],
      pagination: { page: 1, total: 1, totalPages: 1 },
    });
  });

  it('T026: contact update sends PUT /api/v1/contacts/{id} with only changed fields', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'contact',
          contactOperation: 'update',
          contactId: '00000000-0000-0000-0000-000000000104',
          contactUpdateAdditionalFields: {
            email: 'ada@example.com',
            notes: '',
            client_id: { mode: 'id', value: '00000000-0000-0000-0000-000000000105' },
          },
        },
      ],
      () => ({ data: { contact_name_id: '00000000-0000-0000-0000-000000000104' } }),
    );

    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/contacts/00000000-0000-0000-0000-000000000104',
    );
    expect(requests[0]?.body).toEqual({
      email: 'ada@example.com',
      client_id: '00000000-0000-0000-0000-000000000105',
    });
  });

  it('T027: contact update returns the normalized updated contact object', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'contact',
          contactOperation: 'update',
          contactId: '00000000-0000-0000-0000-000000000106',
          contactUpdateAdditionalFields: {
            role: 'Director of Automation',
          },
        },
      ],
      () => ({
        data: {
          contact_name_id: '00000000-0000-0000-0000-000000000106',
          role: 'Director of Automation',
        },
      }),
    );

    expect(output[0][0].json).toEqual({
      contact_name_id: '00000000-0000-0000-0000-000000000106',
      role: 'Director of Automation',
    });
  });

  it('T028: contact delete sends DELETE /api/v1/contacts/{id}', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'contact',
          contactOperation: 'delete',
          contactId: '00000000-0000-0000-0000-000000000107',
        },
      ],
      () => undefined,
    );

    expect(requests[0]?.method).toBe('DELETE');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/contacts/00000000-0000-0000-0000-000000000107',
    );
  });

  it('T029: contact delete returns a non-empty normalized success object', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'contact',
          contactOperation: 'delete',
          contactId: '00000000-0000-0000-0000-000000000108',
        },
      ],
      () => undefined,
    );

    expect(output[0][0].json).toEqual({
      success: true,
      id: '00000000-0000-0000-0000-000000000108',
      deleted: true,
    });
  });

  it('T030: contact get rejects an empty contactId before making a request', async () => {
    const result = await executeNodeExpectFailure([
      {
        resource: 'contact',
        contactOperation: 'get',
        contactId: '',
      },
    ]);

    expect(result.error).toBeInstanceOf(NodeOperationError);
    expect(result.requests).toHaveLength(0);
  });

  it('T031: contact update rejects an invalid UUID contactId before making a request', async () => {
    const result = await executeNodeExpectFailure([
      {
        resource: 'contact',
        contactOperation: 'update',
        contactId: 'not-a-uuid',
        contactUpdateAdditionalFields: {
          role: 'Operations',
        },
      },
    ]);

    expect(result.error).toBeInstanceOf(NodeOperationError);
    expect(result.requests).toHaveLength(0);
  });

  it('T032: contact delete rejects an invalid UUID contactId before making a request', async () => {
    const result = await executeNodeExpectFailure([
      {
        resource: 'contact',
        contactOperation: 'delete',
        contactId: 'still-not-a-uuid',
      },
    ]);

    expect(result.error).toBeInstanceOf(NodeOperationError);
    expect(result.requests).toHaveLength(0);
  });

  it('T033: contact continue-on-fail returns item-level error objects while later items still execute', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'contact',
          contactOperation: 'get',
          contactId: '00000000-0000-0000-0000-000000000109',
        },
        {
          resource: 'contact',
          contactOperation: 'get',
          contactId: '00000000-0000-0000-0000-000000000110',
        },
      ],
      (_options, index) => {
        if (index === 0) {
          throw createApiError(404, 'NOT_FOUND', 'Contact not found', { contactId: 'missing' });
        }

        return { data: { contact_name_id: '00000000-0000-0000-0000-000000000110' } };
      },
      true,
    );

    expect(output[0]).toHaveLength(2);
    expect(output[0][0].json).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Contact not found',
        details: { contactId: 'missing' },
        statusCode: 404,
      },
    });
    expect(output[0][1].json).toEqual({
      contact_name_id: '00000000-0000-0000-0000-000000000110',
    });
  });

  it('T031: Continue On Fail emits item-level errors and continues remaining items', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'ticket',
          ticketOperation: 'get',
          ticketId: '00000000-0000-0000-0000-000000000029',
        },
        {
          resource: 'ticket',
          ticketOperation: 'get',
          ticketId: '00000000-0000-0000-0000-000000000030',
        },
      ],
      (_options, index) => {
        if (index === 0) {
          throw createApiError(404, 'NOT_FOUND', 'Ticket not found', { ticketId: 'missing' });
        }

        return { data: { ticket_id: '00000000-0000-0000-0000-000000000030' } };
      },
      true,
    );

    expect(output[0]).toHaveLength(2);
    expect(output[0][0].json).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Ticket not found',
        details: { ticketId: 'missing' },
        statusCode: 404,
      },
    });
    expect(output[0][1].json).toEqual({ ticket_id: '00000000-0000-0000-0000-000000000030' });
  });

  it('T032: Client helper list maps to GET /api/v1/clients and returns list output', async () => {
    const { requests, output } = await executeNode(
      [
        {
          resource: 'client',
          clientOperation: 'list',
          helperPage: 1,
          helperLimit: 25,
          helperSearch: 'acme',
        },
      ],
      () => ({ data: [{ client_id: '1', client_name: 'Acme' }] }),
    );

    expect(requests[0]?.url).toBe('https://api.algapsa.test/api/v1/clients');
    expect(output[0][0].json).toEqual({ data: [{ client_id: '1', client_name: 'Acme' }] });
  });

  it('T033: Board helper list maps to GET /api/v1/boards and returns list output', async () => {
    const { requests, output } = await executeNode(
      [
        {
          resource: 'board',
          boardOperation: 'list',
          helperPage: 1,
          helperLimit: 25,
          helperSearch: '',
        },
      ],
      () => ({ data: [{ board_id: '1', board_name: 'Help Desk' }] }),
    );

    expect(requests[0]?.url).toBe('https://api.algapsa.test/api/v1/boards');
    expect(output[0][0].json).toEqual({ data: [{ board_id: '1', board_name: 'Help Desk' }] });
  });

  it('T034: Status helper list maps to GET /api/v1/statuses and returns list output', async () => {
    const { requests, output } = await executeNode(
      [
        {
          resource: 'status',
          statusOperation: 'list',
          helperStatusType: 'project_task',
          helperPage: 1,
          helperLimit: 25,
          helperSearch: '',
        },
      ],
      () => ({ data: [{ status_id: '1', name: 'New' }] }),
    );

    expect(requests[0]?.url).toBe('https://api.algapsa.test/api/v1/statuses');
    expect(requests[0]?.qs).toMatchObject({
      page: 1,
      limit: 25,
      type: 'project_task',
    });
    expect(output[0][0].json).toEqual({ data: [{ status_id: '1', name: 'New' }] });
  });

  it('T035: Priority helper list maps to GET /api/v1/priorities and returns list output', async () => {
    const { requests, output } = await executeNode(
      [
        {
          resource: 'priority',
          priorityOperation: 'list',
          helperPage: 1,
          helperLimit: 25,
          helperSearch: '',
        },
      ],
      () => ({ data: [{ priority_id: '1', priority_name: 'High' }] }),
    );

    expect(requests[0]?.url).toBe('https://api.algapsa.test/api/v1/priorities');
    expect(output[0][0].json).toEqual({
      data: [{ priority_id: '1', priority_name: 'High' }],
    });
  });

  it('T040: manual UUID fallback path still executes operations when lookup lists fail', async () => {
    const { requests } = await executeNode(
      [
        {
          ...baseCreateParams,
          createAdditionalFields: {},
        },
      ],
      () => ({ data: { ticket_id: 'created' } }),
    );

    expect(requests[0]?.body).toMatchObject({
      client_id: '00000000-0000-0000-0000-000000000001',
      board_id: '00000000-0000-0000-0000-000000000002',
      status_id: '00000000-0000-0000-0000-000000000003',
      priority_id: '00000000-0000-0000-0000-000000000004',
    });
  });

  it('T042: validation blocks outbound calls for missing required IDs and search query', async () => {
    await expect(
      executeNode(
        [
          {
            ...baseCreateParams,
            client_id: { mode: 'id', value: '' },
            createAdditionalFields: {},
          },
        ],
        () => ({ data: {} }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);

    await expect(
      executeNode(
        [
          {
            resource: 'ticket',
            ticketOperation: 'search',
            query: '',
            searchLimit: 25,
            searchAdditionalFields: {},
          },
        ],
        () => ({ data: [] }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });

  const baseProjectTaskCreateParams = {
    resource: 'projectTask',
    projectTaskOperation: 'create',
    task_name: 'Draft proposal',
    projectTaskProjectId: { mode: 'id', value: '00000000-0000-0000-0000-000000000201' },
    projectTaskPhaseId: { mode: 'id', value: '00000000-0000-0000-0000-000000000202' },
    projectTaskStatusMappingId: { mode: 'id', value: '00000000-0000-0000-0000-000000000203' },
  };

  it('T080: project task create sends POST /api/v1/projects/{projectId}/phases/{phaseId}/tasks', async () => {
    const { requests } = await executeNode(
      [
        {
          ...baseProjectTaskCreateParams,
          projectTaskCreateAdditionalFields: {},
        },
      ],
      () => ({ data: { task_id: '00000000-0000-0000-0000-000000000204' } }),
    );

    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/projects/00000000-0000-0000-0000-000000000201/phases/00000000-0000-0000-0000-000000000202/tasks',
    );
    expect(requests[0]?.body).toEqual({
      task_name: 'Draft proposal',
      project_status_mapping_id: '00000000-0000-0000-0000-000000000203',
    });
  });

  it('T081: project task create includes optional fields only when provided', async () => {
    const { requests } = await executeNode(
      [
        {
          ...baseProjectTaskCreateParams,
          projectTaskCreateAdditionalFields: {
            description: 'Write RFC for new billing pipeline',
            assigned_to: '00000000-0000-0000-0000-000000000205',
            estimated_hours: 6,
            due_date: '2026-05-15',
            priority_id: '00000000-0000-0000-0000-000000000206',
            task_type_key: 'design',
            wbs_code: '2.1',
            tags: 'billing,design',
          },
        },
      ],
      () => ({ data: { task_id: '00000000-0000-0000-0000-000000000204' } }),
    );

    expect(requests[0]?.body).toEqual({
      task_name: 'Draft proposal',
      project_status_mapping_id: '00000000-0000-0000-0000-000000000203',
      description: 'Write RFC for new billing pipeline',
      assigned_to: '00000000-0000-0000-0000-000000000205',
      estimated_hours: 6,
      due_date: '2026-05-15',
      priority_id: '00000000-0000-0000-0000-000000000206',
      task_type_key: 'design',
      wbs_code: '2.1',
      tags: ['billing', 'design'],
    });
  });

  it('T082: project task create unwraps the created task object from the data wrapper', async () => {
    const { output } = await executeNode(
      [
        {
          ...baseProjectTaskCreateParams,
          projectTaskCreateAdditionalFields: {},
        },
      ],
      () => ({
        data: {
          task_id: '00000000-0000-0000-0000-000000000204',
          task_name: 'Draft proposal',
        },
      }),
    );

    expect(output[0][0].json).toEqual({
      task_id: '00000000-0000-0000-0000-000000000204',
      task_name: 'Draft proposal',
    });
  });

  it('T083: project task create rejects missing project/phase/status mapping IDs before request', async () => {
    await expect(
      executeNode(
        [
          {
            ...baseProjectTaskCreateParams,
            projectTaskProjectId: { mode: 'id', value: '' },
            projectTaskCreateAdditionalFields: {},
          },
        ],
        () => ({ data: {} }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);

    await expect(
      executeNode(
        [
          {
            ...baseProjectTaskCreateParams,
            projectTaskPhaseId: { mode: 'id', value: '' },
            projectTaskCreateAdditionalFields: {},
          },
        ],
        () => ({ data: {} }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);

    await expect(
      executeNode(
        [
          {
            ...baseProjectTaskCreateParams,
            projectTaskStatusMappingId: { mode: 'id', value: '' },
            projectTaskCreateAdditionalFields: {},
          },
        ],
        () => ({ data: {} }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });

  it('T084: project task get sends GET /api/v1/projects/tasks/{taskId}', async () => {
    const { requests, output } = await executeNode(
      [
        {
          resource: 'projectTask',
          projectTaskOperation: 'get',
          projectTaskId: '00000000-0000-0000-0000-000000000210',
        },
      ],
      () => ({
        data: {
          task_id: '00000000-0000-0000-0000-000000000210',
          task_name: 'Existing task',
        },
      }),
    );

    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/projects/tasks/00000000-0000-0000-0000-000000000210',
    );
    expect(output[0][0].json).toEqual({
      task_id: '00000000-0000-0000-0000-000000000210',
      task_name: 'Existing task',
    });
  });

  it('T085: project task list sends GET /api/v1/projects/{projectId}/tasks with pagination', async () => {
    const { requests, output } = await executeNode(
      [
        {
          resource: 'projectTask',
          projectTaskOperation: 'list',
          projectTaskProjectId: {
            mode: 'id',
            value: '00000000-0000-0000-0000-000000000220',
          },
          projectTaskPage: 2,
          projectTaskLimit: 50,
        },
      ],
      () => ({
        data: [{ task_id: '00000000-0000-0000-0000-000000000221' }],
        pagination: { page: 2, total: 1 },
      }),
    );

    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/projects/00000000-0000-0000-0000-000000000220/tasks',
    );
    expect(requests[0]?.qs).toEqual({ page: 2, limit: 50 });
    expect(output[0][0].json).toEqual({
      data: [{ task_id: '00000000-0000-0000-0000-000000000221' }],
      pagination: { page: 2, total: 1 },
    });
  });

  it('T086: project task update sends PUT with only provided fields', async () => {
    const { requests } = await executeNode(
      [
        {
          resource: 'projectTask',
          projectTaskOperation: 'update',
          projectTaskId: '00000000-0000-0000-0000-000000000230',
          projectTaskUpdateAdditionalFields: {
            task_name: 'Renamed task',
            description: '',
            project_status_mapping_id: '00000000-0000-0000-0000-000000000231',
          },
        },
      ],
      () => ({ data: { task_id: '00000000-0000-0000-0000-000000000230' } }),
    );

    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/projects/tasks/00000000-0000-0000-0000-000000000230',
    );
    expect(requests[0]?.body).toEqual({
      task_name: 'Renamed task',
      project_status_mapping_id: '00000000-0000-0000-0000-000000000231',
    });
  });

  it('T087: project task update rejects an empty update collection before request', async () => {
    await expect(
      executeNode(
        [
          {
            resource: 'projectTask',
            projectTaskOperation: 'update',
            projectTaskId: '00000000-0000-0000-0000-000000000232',
            projectTaskUpdateAdditionalFields: {},
          },
        ],
        () => ({ data: {} }),
      ),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });

  it('T088: project task delete sends DELETE and returns a success envelope', async () => {
    const { requests, output } = await executeNode(
      [
        {
          resource: 'projectTask',
          projectTaskOperation: 'delete',
          projectTaskId: '00000000-0000-0000-0000-000000000240',
        },
      ],
      () => undefined,
    );

    expect(requests[0]?.method).toBe('DELETE');
    expect(requests[0]?.url).toBe(
      'https://api.algapsa.test/api/v1/projects/tasks/00000000-0000-0000-0000-000000000240',
    );
    expect(output[0][0].json).toEqual({
      success: true,
      id: '00000000-0000-0000-0000-000000000240',
      deleted: true,
    });
  });

  it('T089: project task get/update/delete reject invalid UUIDs before request', async () => {
    const getResult = await executeNodeExpectFailure([
      {
        resource: 'projectTask',
        projectTaskOperation: 'get',
        projectTaskId: 'not-a-uuid',
      },
    ]);
    expect(getResult.error).toBeInstanceOf(NodeOperationError);
    expect(getResult.requests).toHaveLength(0);

    const deleteResult = await executeNodeExpectFailure([
      {
        resource: 'projectTask',
        projectTaskOperation: 'delete',
        projectTaskId: '',
      },
    ]);
    expect(deleteResult.error).toBeInstanceOf(NodeOperationError);
  });

  it('T090: project task continue-on-fail emits item-level errors while later items still execute', async () => {
    const { output } = await executeNode(
      [
        {
          resource: 'projectTask',
          projectTaskOperation: 'get',
          projectTaskId: '00000000-0000-0000-0000-000000000250',
        },
        {
          resource: 'projectTask',
          projectTaskOperation: 'get',
          projectTaskId: '00000000-0000-0000-0000-000000000251',
        },
      ],
      (_options, index) => {
        if (index === 0) {
          throw createApiError(404, 'NOT_FOUND', 'Task not found', { taskId: 'missing' });
        }

        return { data: { task_id: '00000000-0000-0000-0000-000000000251' } };
      },
      true,
    );

    expect(output[0]).toHaveLength(2);
    expect(output[0][0].json).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Task not found',
        details: { taskId: 'missing' },
        statusCode: 404,
      },
    });
    expect(output[0][1].json).toEqual({
      task_id: '00000000-0000-0000-0000-000000000251',
    });
  });
});
