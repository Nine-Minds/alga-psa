/**
 * T127 — F065 of `ee/plans/2026-11-21-itil-remediation` (`impact-urgency`).
 *
 * A template that carries Impact and Urgency has them decide the priority of every ticket it
 * instantiates (R4), even when the template's stored `priority_id` says something else — the case
 * a schedule hits on every occurrence. The rule itself is proven against a database in
 * `server/src/test/integration/itilImpactUrgency.integration.test.ts`; here the point is that the
 * template path asks it, with the template's own board, priority and pair, and stores its answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let templates: Record<string, any>[];
const createTicketWithSideEffectsMock = vi.fn();
const resolveMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: (name: string) => query(name) }),
}));
vi.mock('@alga-psa/shared/services/tickets/createTicketWithSideEffects', () => ({
  createTicketWithSideEffects: (...args: unknown[]) => createTicketWithSideEffectsMock(...args),
}));
vi.mock('../ticketFieldReferences', () => ({
  findTicketFieldReferenceProblems: async () => [],
  resolveTicketPriorityFieldsOrThrow: (...args: unknown[]) => resolveMock(...args),
}));

function query(table: string): any {
  let filters: Record<string, any> = {};
  const builder: any = {
    where: (value: Record<string, any>) => { filters = value; return builder; },
    orderBy: () => builder,
    select: async () => [],
    first: async () => (table === 'ticket_templates'
      ? templates.find((row) => row.template_id === filters.template_id)
      : undefined),
  };
  return builder;
}

import { instantiateTicketTemplate, TicketTemplateInstantiationError } from '../instantiateTicketTemplate';

const dispatch = { status_id: null, assigned_to: null, assigned_team_id: null, additional_agent_ids: [] };

function input(templateId: string) {
  return {
    templateId,
    client: { client_id: 'client-1' },
    overrides: [],
    dispatch,
    actor: { type: 'user' as const, userId: 'user-1' },
    titleContext: {},
    origin: { ticket_origin: 'recurring' as const, source: 'recurring_schedule' },
  };
}

describe('instantiateTicketTemplate Impact × Urgency', () => {
  beforeEach(() => {
    createTicketWithSideEffectsMock.mockReset();
    createTicketWithSideEffectsMock.mockResolvedValue({ ticketId: 'ticket-1', ticketNumber: 'TIC-1' });
    resolveMock.mockReset();
    templates = [
      {
        template_id: 'assessed', name: 'Quarterly review', title: 'Review', description: null,
        client_id: null, board_id: 'itil-board', category_id: null, subcategory_id: null,
        // The stored priority is level 5; the pair computes level 1.
        priority_id: 'itil-level-5', itil_impact: 1, itil_urgency: 1, tags: [], custom_fields: {},
      },
      {
        template_id: 'unassessed', name: 'Ad hoc', title: 'Ad hoc', description: null,
        client_id: null, board_id: 'own-board', category_id: null, subcategory_id: null,
        priority_id: 'own-routine', itil_impact: null, itil_urgency: null, tags: [], custom_fields: {},
      },
    ];
  });

  it('T127: stores the matrix priority, not the template’s stored one', async () => {
    resolveMock.mockResolvedValue({
      priority_id: 'itil-level-1',
      itil_impact: 1,
      itil_urgency: 1,
      problems: [],
    });

    await instantiateTicketTemplate({} as any, 'tenant-1', input('assessed'));

    // Asked with the template's own board, stored priority and pair, on the instantiating
    // transaction, and refusing rather than falling back (a schedule reports the occurrence).
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock.mock.calls[0][2]).toMatchObject({
      boardId: 'itil-board',
      priorityId: 'itil-level-5',
      itilImpact: 1,
      itilUrgency: 1,
      policy: 'refuse',
    });

    const ticket = createTicketWithSideEffectsMock.mock.calls[0][2].ticket;
    expect(ticket.priority_id).toBe('itil-level-1');
    expect(ticket.itil_impact).toBe(1);
    expect(ticket.itil_urgency).toBe(1);
  });

  it('T127: a template on a board with the tenant’s own priorities stores no assessment', async () => {
    resolveMock.mockResolvedValue({
      priority_id: 'own-routine',
      itil_impact: null,
      itil_urgency: null,
      problems: [],
    });

    await instantiateTicketTemplate({} as any, 'tenant-1', input('unassessed'));

    const ticket = createTicketWithSideEffectsMock.mock.calls[0][2].ticket;
    expect(ticket.priority_id).toBe('own-routine');
    expect(ticket.itil_impact).toBeUndefined();
    expect(ticket.itil_urgency).toBeUndefined();
  });

  it('T127: a refusal is reported per occurrence, and no ticket is created', async () => {
    resolveMock.mockRejectedValue(new Error('Impact and urgency must be set together'));

    const error = await instantiateTicketTemplate({} as any, 'tenant-1', input('assessed')).catch((caught) => caught);

    expect(error).toBeInstanceOf(TicketTemplateInstantiationError);
    expect((error as TicketTemplateInstantiationError).code).toBe('INVALID_REFERENCES');
    expect(createTicketWithSideEffectsMock).not.toHaveBeenCalled();
  });
});
