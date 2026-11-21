import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rows the fake tenantDb serves: one tenant-wide template and one bound to client-1.
let templates: Record<string, any>[];
const createTicketWithSideEffectsMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: (name: string) => query(name) }),
}));
vi.mock('@alga-psa/shared/services/tickets/createTicketWithSideEffects', () => ({
  createTicketWithSideEffects: (...args: unknown[]) => createTicketWithSideEffectsMock(...args),
}));
vi.mock('../ticketFieldReferences', () => ({
  findTicketFieldReferenceProblems: async () => [],
}));

function query(table: string): any {
  let filters: Record<string, any> = {};
  const builder: any = {
    where: (value: Record<string, any>) => { filters = value; return builder; },
    orderBy: () => builder,
    select: async () => (table === 'ticket_template_checklist_items' ? [] : []),
    first: async () => (table === 'ticket_templates'
      ? templates.find((row) => row.template_id === filters.template_id)
      : undefined),
  };
  return builder;
}

import {
  instantiateTicketTemplate,
  resolveTemplateTicketFields,
  TicketTemplateInstantiationError,
} from '../instantiateTicketTemplate';

const dispatch = { status_id: null, assigned_to: null, assigned_team_id: null, additional_agent_ids: [] };

function input(templateId: string, clientId: string) {
  return {
    templateId,
    client: { client_id: clientId },
    overrides: [],
    dispatch,
    actor: { type: 'user' as const, userId: 'user-1' },
    titleContext: {},
    origin: { ticket_origin: 'api' as const, source: 'api' },
  };
}

describe('instantiateTicketTemplate client scope', () => {
  beforeEach(() => {
    createTicketWithSideEffectsMock.mockReset();
    createTicketWithSideEffectsMock.mockResolvedValue({ ticketId: 'ticket-1', ticketNumber: 'TIC-1' });
    templates = [
      {
        template_id: 'tenant-wide', name: 'Onboarding', title: 'Onboard', description: null,
        client_id: null, board_id: 'board-1', category_id: null, subcategory_id: null,
        priority_id: 'priority-1', itil_impact: null, itil_urgency: null, tags: [], custom_fields: {},
      },
      {
        template_id: 'client-bound', name: 'Case manager onboarding', title: 'Onboard CM', description: null,
        client_id: 'client-1', board_id: 'board-1', category_id: null, subcategory_id: null,
        priority_id: 'priority-1', itil_impact: null, itil_urgency: null, tags: [], custom_fields: {},
      },
    ];
  });

  it('refuses a client-bound template applied to another client', async () => {
    await expect(instantiateTicketTemplate({} as any, 'tenant-1', input('client-bound', 'client-2')))
      .rejects.toMatchObject({ code: 'CLIENT_MISMATCH' });
    expect(createTicketWithSideEffectsMock).not.toHaveBeenCalled();
  });

  it('creates the ticket for the template’s own client', async () => {
    const result = await instantiateTicketTemplate({} as any, 'tenant-1', input('client-bound', 'client-1'));
    expect(result).toEqual({ ticketId: 'ticket-1', ticketNumber: 'TIC-1' });
  });

  it('creates the ticket for any client when the template is tenant-wide', async () => {
    await instantiateTicketTemplate({} as any, 'tenant-1', input('tenant-wide', 'client-2'));
    expect(createTicketWithSideEffectsMock).toHaveBeenCalledTimes(1);
  });

  it('still reports a missing template as TEMPLATE_NOT_FOUND', async () => {
    const error = await instantiateTicketTemplate({} as any, 'tenant-1', input('gone', 'client-1')).catch((e) => e);
    expect(error).toBeInstanceOf(TicketTemplateInstantiationError);
    expect(error.code).toBe('TEMPLATE_NOT_FOUND');
  });
});

describe('resolveTemplateTicketFields', () => {
  it('is unchanged by the client scope: it never reads client_id', () => {
    const template = { client_id: null, board_id: 'board-1', priority_id: 'priority-1', category_id: null, subcategory_id: null };
    const bound = { ...template, client_id: 'client-1' };
    expect(resolveTemplateTicketFields(template, dispatch, [])).toEqual(
      resolveTemplateTicketFields(bound, dispatch, [])
    );
    expect(resolveTemplateTicketFields(template, dispatch, [])).toMatchObject({
      board_id: 'board-1',
      priority_id: 'priority-1',
      status_id: null,
    });
  });
});
