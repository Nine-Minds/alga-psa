import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getAllMatchingTicketIds: vi.fn(),
  getTicketReadTargetsByIds: vi.fn(),
  loadTicketListItemsByIds: vi.fn(),
}));
vi.mock('@alga-psa/tickets/schemas/ticket.schema', () => ({ ticketListFiltersSchema: { parse: (v: unknown) => v } }));
vi.mock('@alga-psa/search/acl', () => ({ aclPredicateSql: vi.fn(), resolveSearchAclPrincipal: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));

import { approxTokens } from '../../services/smartSearch/budgets';
import { buildRelevanceRequest } from '../../services/smartSearch/scoreBatch';
import { assembleTicketCandidate, ticketSmartSearch } from '../../services/smartSearch/entities/ticket';
import { getAllMatchingTicketIds, getTicketReadTargetsByIds, loadTicketListItemsByIds } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { redactTicketReadPayload } from '@alga-psa/tickets/lib';

const row = (description: string | null = 'A plain description.') => ({
  ticket_id: 'tid',
  ticket_number: 'T-1',
  title: 'Printer offline',
  description,
  client_name: 'Acme',
  status_name: 'Open',
  is_closed: false,
  priority_name: 'High',
  board_name: 'Support',
  assigned_to_name: 'Sam Tech',
  assigned_team_name: null,
  entered_at: new Date('2026-09-01T10:00:00Z'),
  updated_at: '2026-09-02T10:00:00.000Z',
  closed_at: null,
  due_date: null,
});

describe('assembleTicketCandidate', () => {
  it('renders the ticket as named facts and ISO dates, description, then comments newest first', () => {
    const candidate = assembleTicketCandidate(row('desc'), [
      { author: 'client', text: 'newest' },
      { author: 'technician', text: '   ' },
      { author: 'technician', text: 'older' },
    ]);
    expect(candidate.id).toBe('tid');
    expect(candidate.state).toEqual({
      ticket_number: 'T-1',
      title: 'Printer offline',
      client: 'Acme',
      status: 'Open',
      is_closed: false,
      priority: 'High',
      board: 'Support',
      assigned_to: 'Sam Tech',
      assigned_team: null,
      entered_at: '2026-09-01T10:00:00.000Z',
      updated_at: '2026-09-02T10:00:00.000Z',
      closed_at: null,
      due_date: null,
      description: 'desc',
      comments: [
        { author: 'client', text: 'newest' },
        { author: 'technician', text: 'older' },
      ],
    });
    expect(JSON.stringify(candidate.state)).not.toContain('tid');
    expect(candidate.approxTokens).toBeGreaterThan(approxTokens('Printer offline') + approxTokens('T-1') + approxTokens('Acme') + approxTokens('desc'));
  });

  it('normalizes blank facts and unparseable dates', () => {
    const candidate = assembleTicketCandidate({ ...row('desc'), is_closed: true, closed_at: 'not a date', status_name: '  ' }, []);
    expect(candidate.state.is_closed).toBe(true);
    expect(candidate.state.closed_at).toBeNull();
    expect(candidate.state.status).toBeNull();
  });

  it('falls back to the ticket number when the title is empty and tolerates a null description', () => {
    const candidate = assembleTicketCandidate({ ...row(null), title: '' }, []);
    expect(candidate.state.title).toBe('T-1');
    expect(candidate.state.description).toBe('');
    expect(candidate.state.client).toBe('Acme');
  });

  it('keeps restricted ticket fields and derived comments out of the scorer candidate', () => {
    const candidate = assembleTicketCandidate(row('SECRET DESCRIPTION'), [
      { author: 'technician', text: 'SECRET COMMENT' },
    ], undefined, ['title', 'description', 'client_name', 'assigned_to', 'due_date']);
    const serialized = JSON.stringify(candidate.state);
    expect(serialized).not.toContain('Printer offline');
    expect(serialized).not.toContain('SECRET DESCRIPTION');
    expect(serialized).not.toContain('Acme');
    expect(serialized).not.toContain('Sam Tech');
    expect(serialized).not.toContain('SECRET COMMENT');
    expect(candidate.state.title).toBe('Restricted ticket');
    expect(candidate.state.description).toBe('');
    expect(candidate.state.due_date).toBeNull();
  });
});

describe('ticket list redaction projection', () => {
  it('masks title, description, client, assignment, dates, and derived activity fields', () => {
    const projected = redactTicketReadPayload({
      title: 'Secret title',
      attributes: { description: 'Secret description', public: true },
      client_name: 'Secret client',
      client_id: 'client-1',
      assigned_to: 'user-1',
      assigned_to_name: 'Secret assignee',
      additional_agents: [{ user_id: 'user-2', name: 'Secret agent' }],
      due_date: '2026-09-01',
      latest_activity_actor: 'Secret author',
      latest_activity_at: '2026-09-01T00:00:00Z',
    }, ['title', 'description', 'client_name', 'assigned_to', 'due_date']);
    expect(projected.title).toBe('Restricted ticket');
    expect(projected.attributes).toEqual({ description: null, public: true });
    expect(projected.client_name).toBeNull();
    expect(projected.client_id).toBeNull();
    expect(projected.assigned_to).toBeNull();
    expect(projected.assigned_to_name).toBeNull();
    expect(projected.additional_agents).toEqual([]);
    expect(projected.due_date).toBeNull();
    expect(projected.latest_activity_actor).toBeNull();
    expect(projected.latest_activity_at).toBeNull();
  });
});

describe('ticketSmartSearch definition', () => {
  it('clears the keyword filter so the chips alone define the candidate set', () => {
    expect(ticketSmartSearch.normalizeScope({ boardFilterState: 'active', searchQuery: 'typed' } as never)).toMatchObject({ searchQuery: '' });
  });

  it('hydrates rows through the ticket by-id loader and reshapes the result', async () => {
    vi.mocked(loadTicketListItemsByIds).mockResolvedValue({
      tickets: [{ ticket_id: 'a' } as never],
      metadata: { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} },
    });
    await expect(ticketSmartSearch.hydrateRows({} as never, ['a'], new Map())).resolves.toEqual({
      rows: [{ ticket_id: 'a' }],
      metadata: { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} },
    });
    vi.mocked(loadTicketListItemsByIds).mockResolvedValue({ permissionError: 'nope' } as never);
    await expect(ticketSmartSearch.hydrateRows({} as never, ['a'], new Map())).resolves.toEqual({ permissionError: 'nope' });
    expect(ticketSmartSearch.rowId({ ticket_id: 'z' } as never)).toBe('z');
  });

  it('enumerates authorized targets with each ticket redaction set and passes it to hydration', async () => {
    vi.mocked(getAllMatchingTicketIds).mockResolvedValue(['a', 'b']);
    vi.mocked(getTicketReadTargetsByIds).mockResolvedValue([
      { id: 'a', redactedFields: ['description'] },
      { id: 'b', redactedFields: [] },
    ]);
    vi.mocked(loadTicketListItemsByIds).mockResolvedValue({
      tickets: [], metadata: { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} },
    });
    await expect(ticketSmartSearch.enumerate({} as never)).resolves.toEqual([
      { id: 'a', redactedFields: ['description'] },
      { id: 'b', redactedFields: [] },
    ]);
    const redactions = new Map([['a', ['description'] as const]]);
    await ticketSmartSearch.hydrateRows({} as never, ['a'], redactions);
    expect(loadTicketListItemsByIds).toHaveBeenLastCalledWith({}, ['a'], { a: ['description'] });
  });

  it('names the ticket facts in the question so a literal reader knows when to use them', () => {
    const request = buildRelevanceRequest(ticketSmartSearch.relevance, 'q', [assembleTicketCandidate(row(), [])]);
    const question = JSON.stringify(request.questions.c0.instructions);
    for (const field of ['status', 'is_closed', 'priority', 'board', 'assigned_to', 'assigned_team', 'due_date', 'closed_at']) {
      expect(question).toContain(field);
    }
    expect(question).toContain('only when `query` refers to such things');
    expect(question).toContain('with ref `c0` (at `candidates[0]`)');
    expect(question).toContain('Judge only that candidate.');
  });

  it('keeps the question wording stable', () => {
    const request = buildRelevanceRequest(ticketSmartSearch.relevance, 'q', [assembleTicketCandidate(row(), [])]);
    expect(request.questions.c0).toMatchInlineSnapshot(`
      {
        "criteria": {
          "false": "The ticket is about a different problem, request, or subject, or its title, description, and comments say nothing about what the query describes, or the query names a status, closed state, priority, board, assignee, team, or time that the ticket does not match. An empty description with no comments is not evidence of relevance. Sharing a client, a technician, a device type, or a few incidental words the query does not ask about does not make it relevant.",
          "true": "The ticket concerns what the query describes, even when it uses different words, names a specific product or vendor where the query names a category, or describes a symptom of the same underlying problem. When the query mentions a status, whether the ticket is closed, a priority, a board, an assignee or team, or a time such as a due date or when it was opened, updated, or closed, the ticket matches on those too.",
        },
        "instructions": {
          "question": "Is the support ticket with ref \`c0\` (at \`candidates[0]\`) about the problem, request, person, device, or subject described by \`query\`, judging from its title, description, and comments? Judge only that candidate. A ticket whose title, description, and comments say nothing about what \`query\` describes is not about it. The candidate also carries its current status, is_closed flag, priority, board, assigned_to, assigned_team, and entered_at, updated_at, closed_at, and due_date as ISO 8601 date-times; use those only when \`query\` refers to such things.",
        },
        "type": "noul",
      }
    `);
  });
});
