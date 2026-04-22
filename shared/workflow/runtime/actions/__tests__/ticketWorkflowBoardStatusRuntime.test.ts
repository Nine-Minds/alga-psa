import { beforeEach, describe, expect, it, vi } from 'vitest';

type RegisteredAction = {
  id: string;
  handler: (input: any, ctx: any) => Promise<any>;
};

type TableRow = Record<string, any>;
type TableMap = Record<string, TableRow[]>;

const runtimeState = vi.hoisted(() => ({
  registeredActions: [] as RegisteredAction[],
  currentTenantTx: null as {
    tenantId: string;
    actorUserId: string;
    trx: any;
  } | null,
  createTicketMock: vi.fn(),
  updateTicketMock: vi.fn(),
  createCommentMock: vi.fn(),
}));

vi.mock('../../registries/actionRegistry', () => ({
  getActionRegistryV2: () => ({
    register: (action: RegisteredAction) => {
      runtimeState.registeredActions.push(action);
    },
  }),
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();

  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => {
      if (!runtimeState.currentTenantTx) {
        throw new Error('Missing tenant transaction context');
      }

      return fn(runtimeState.currentTenantTx);
    },
    requirePermission: async () => {},
    writeRunAudit: async () => {},
  };
});

vi.mock('../../../../models/ticketModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../models/ticketModel')>();

  return {
    TicketModel: {
      getDefaultStatusId: actual.TicketModel.getDefaultStatusId.bind(actual.TicketModel),
      createTicket: runtimeState.createTicketMock,
      updateTicket: runtimeState.updateTicketMock,
      createComment: runtimeState.createCommentMock,
    },
  };
});

vi.mock('../../registries/workflowEmailRegistry', () => ({
  getWorkflowEmailProvider: () => ({
    TenantEmailService: {
      getInstance: () => ({
        sendEmail: vi.fn().mockResolvedValue({ success: true }),
      }),
    },
    StaticTemplateProcessor: class StaticTemplateProcessor {},
  }),
}));

import { TicketModel } from '../../../../models/ticketModel';
import { registerTicketActions } from '../businessOperations/tickets';

class FakeQueryBuilder {
  private conditions: Record<string, any> = {};
  private orderings: Array<{ column: string; direction: 'asc' | 'desc' }> = [];

  constructor(
    private readonly tableName: string,
    private readonly tables: TableMap
  ) {}

  where(columnOrConditions: string | Record<string, any>, value?: any): this {
    if (typeof columnOrConditions === 'string') {
      this.conditions[columnOrConditions] = value;
    } else {
      Object.assign(this.conditions, columnOrConditions);
    }

    return this;
  }

  andWhere(columnOrConditions: string | Record<string, any>, value?: any): this {
    return this.where(columnOrConditions, value);
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderings.push({ column, direction });
    return this;
  }

  select(): this {
    return this;
  }

  async first(): Promise<TableRow | undefined> {
    return this.execute()[0];
  }

  async update(updateData: Record<string, any>): Promise<number> {
    const rows = this.execute();
    rows.forEach((row) => Object.assign(row, updateData));
    return rows.length;
  }

  async insert(data: Record<string, any> | Array<Record<string, any>>): Promise<any> {
    const rows = Array.isArray(data) ? data : [data];
    if (!this.tables[this.tableName]) {
      this.tables[this.tableName] = [];
    }
    this.tables[this.tableName].push(...rows);
    return rows;
  }

  private execute(): TableRow[] {
    const rows = [...(this.tables[this.tableName] ?? [])].filter((row) =>
      Object.entries(this.conditions).every(([column, value]) => row[column] === value)
    );

    return rows.sort((left, right) => {
      for (const ordering of this.orderings) {
        const leftValue = left[ordering.column];
        const rightValue = right[ordering.column];

        if (leftValue === rightValue) {
          continue;
        }

        if (leftValue == null) {
          return ordering.direction === 'asc' ? 1 : -1;
        }

        if (rightValue == null) {
          return ordering.direction === 'asc' ? -1 : 1;
        }

        if (leftValue < rightValue) {
          return ordering.direction === 'asc' ? -1 : 1;
        }

        if (leftValue > rightValue) {
          return ordering.direction === 'asc' ? 1 : -1;
        }
      }

      return 0;
    });
  }
}

function createFakeTrx(tables: TableMap) {
  return ((tableName: string) => new FakeQueryBuilder(tableName, tables)) as any;
}

function setTenantTx(tables: TableMap): void {
  runtimeState.currentTenantTx = {
    tenantId: 'tenant-1',
    actorUserId: 'user-1',
    trx: createFakeTrx(tables),
  };
}

function getAction(actionId: string): RegisteredAction {
  const action = runtimeState.registeredActions.find((entry) => entry.id === actionId);
  if (!action) {
    throw new Error(`Expected registered action ${actionId}`);
  }

  return action;
}

function createActionContext() {
  return {
    runId: 'run-1',
    stepPath: 'step-1',
    tenantId: 'tenant-1',
    idempotencyKey: 'key-1',
    attempt: 1,
    nowIso: () => '2026-03-14T00:00:00.000Z',
    env: {},
  };
}

describe('ticket workflow runtime board-scoped statuses', () => {
  beforeEach(() => {
    runtimeState.registeredActions.length = 0;
    runtimeState.currentTenantTx = null;
    runtimeState.createTicketMock.mockReset();
    runtimeState.updateTicketMock.mockReset();
    runtimeState.createCommentMock.mockReset();
    registerTicketActions();
  });

  it('T037: tickets.create rejects a status id that does not belong to the chosen board', async () => {
    setTenantTx({
      statuses: [
        {
          tenant: 'tenant-1',
          status_id: 'status-board-b',
          status_type: 'ticket',
          board_id: 'board-b',
        },
      ],
    });
    runtimeState.createTicketMock.mockResolvedValue({
      ticket_id: 'ticket-1',
      ticket_number: 'T-1',
      entered_at: '2026-03-14T00:00:00.000Z',
      status_id: 'status-board-b',
      priority_id: 'priority-1',
    });

    const action = getAction('tickets.create');

    await expect(
      action.handler(
        {
          client_id: 'client-1',
          title: 'Workflow ticket',
          description: 'Created from workflow',
          board_id: 'board-a',
          status_id: 'status-board-b',
          priority_id: 'priority-1',
        },
        createActionContext()
      )
    ).rejects.toMatchObject({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Invalid status_id for selected board',
    });

    expect(runtimeState.createTicketMock).not.toHaveBeenCalled();
  });

  it('T038: tickets.update_fields rejects a cross-board status id for the current ticket board', async () => {
    setTenantTx({
      tickets: [
        {
          tenant: 'tenant-1',
          ticket_id: 'ticket-1',
          board_id: 'board-a',
          status_id: 'status-board-a-open',
        },
      ],
      statuses: [
        {
          tenant: 'tenant-1',
          status_id: 'status-board-b-open',
          status_type: 'ticket',
          board_id: 'board-b',
        },
      ],
    });
    runtimeState.updateTicketMock.mockResolvedValue({
      ticket_id: 'ticket-1',
      updated_at: '2026-03-14T00:00:00.000Z',
      status_id: 'status-board-b-open',
      priority_id: null,
      attributes: {},
    });

    const action = getAction('tickets.update_fields');

    await expect(
      action.handler(
        {
          ticket_id: 'ticket-1',
          patch: {
            status_id: 'status-board-b-open',
          },
        },
        createActionContext()
      )
    ).rejects.toMatchObject({
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Invalid status_id for selected board',
    });

    expect(runtimeState.updateTicketMock).not.toHaveBeenCalled();
  });

  it("T039: tickets.close resolves the closed status from the ticket's current board only", async () => {
    const tables: TableMap = {
      tickets: [
        {
          tenant: 'tenant-1',
          ticket_id: 'ticket-1',
          board_id: 'board-a',
          status_id: 'status-board-a-open',
          closed_at: null,
          ticket_number: 'T-1',
          title: 'Workflow ticket',
          contact_name_id: null,
        },
      ],
      statuses: [
        {
          tenant: 'tenant-1',
          status_id: 'status-board-a-open',
          status_type: 'ticket',
          board_id: 'board-a',
          is_closed: false,
          is_default: true,
          order_number: 1,
        },
        {
          tenant: 'tenant-1',
          status_id: 'status-board-a-closed',
          status_type: 'ticket',
          board_id: 'board-a',
          is_closed: true,
          is_default: true,
          order_number: 20,
        },
        {
          tenant: 'tenant-1',
          status_id: 'status-board-b-closed',
          status_type: 'ticket',
          board_id: 'board-b',
          is_closed: true,
          is_default: true,
          order_number: 1,
        },
      ],
    };
    setTenantTx(tables);

    const action = getAction('tickets.close');

    const result = await action.handler(
      {
        ticket_id: 'ticket-1',
        resolution: {
          code: 'resolved',
        },
      },
      createActionContext()
    );

    expect(result.final_status_id).toBe('status-board-a-closed');
    expect(tables.tickets[0]?.status_id).toBe('status-board-a-closed');
    expect(tables.tickets[0]?.closed_at).toBe('2026-03-14T00:00:00.000Z');
  });

  it('T040: tickets.create writes real ticket tag mappings while preserving mirrored attributes.tags', async () => {
    const tables: TableMap = { statuses: [], tag_definitions: [], tag_mappings: [] };
    setTenantTx(tables);
    runtimeState.createTicketMock.mockResolvedValue({
      ticket_id: 'ticket-1',
      ticket_number: 'T-1',
      entered_at: '2026-03-14T00:00:00.000Z',
      status_id: 'status-board-a-open',
      priority_id: 'priority-1',
    });

    const action = getAction('tickets.create');

    await action.handler(
      {
        client_id: 'client-1',
        title: 'Workflow ticket',
        description: 'Created from workflow',
        board_id: 'board-a',
        priority_id: 'priority-1',
        tags: ['Look at the spaces'],
      },
      createActionContext()
    );

    expect(runtimeState.createTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          tags: ['Look at the spaces'],
        }),
      }),
      'tenant-1',
      expect.any(Function),
      {},
      undefined,
      undefined,
      'user-1'
    );

    expect(tables.tag_definitions).toHaveLength(1);
    expect(tables.tag_definitions[0]).toMatchObject({
      tenant: 'tenant-1',
      tag_text: 'Look at the spaces',
      tagged_type: 'ticket',
      text_color: '#2C3E50',
    });

    expect(tables.tag_mappings).toHaveLength(1);
    expect(tables.tag_mappings[0]).toMatchObject({
      tenant: 'tenant-1',
      tag_id: tables.tag_definitions[0]?.tag_id,
      tagged_id: 'ticket-1',
      tagged_type: 'ticket',
      created_by: 'user-1',
    });
  });

  it("T041: tickets.create returns the selected board's default status when workflow input omits status_id", async () => {
    setTenantTx({
      statuses: [
        {
          tenant: 'tenant-1',
          status_id: 'status-board-a-default',
          status_type: 'ticket',
          board_id: 'board-a',
          is_default: true,
          order_number: 2,
        },
        {
          tenant: 'tenant-1',
          status_id: 'status-board-b-default',
          status_type: 'ticket',
          board_id: 'board-b',
          is_default: true,
          order_number: 1,
        },
      ],
    });
    runtimeState.createTicketMock.mockImplementation(async (input, tenant, trx) => ({
      ticket_id: 'ticket-2',
      ticket_number: 'T-2',
      entered_at: '2026-03-14T00:00:00.000Z',
      status_id: input.status_id ?? (await TicketModel.getDefaultStatusId(tenant, trx, input.board_id)),
      priority_id: input.priority_id,
    }));

    const action = getAction('tickets.create');

    const result = await action.handler(
      {
        client_id: 'client-1',
        title: 'Workflow defaulted ticket',
        description: 'Created from workflow without explicit status',
        board_id: 'board-a',
        priority_id: 'priority-1',
      },
      createActionContext()
    );

    expect(runtimeState.createTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: 'board-a',
        status_id: undefined,
      }),
      'tenant-1',
      expect.any(Function),
      {},
      undefined,
      undefined,
      'user-1'
    );
    expect(result.status_id).toBe('status-board-a-default');
  });
});
