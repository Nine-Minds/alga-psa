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
  dbUpdates: [] as Array<{
    tableName: string;
    conditions: Record<string, any>;
    updateData: Record<string, any>;
  }>,
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
  private comparisons: Array<{ column: string; operator: string; value: any }> = [];
  private orderings: Array<{ column: string; direction: 'asc' | 'desc' }> = [];
  private joins: Array<{
    tableName: string;
    alias: string;
    clauses: Array<{ left: string; operator: string; right: string }>;
  }> = [];
  private selectedColumns: string[] = [];
  private limitCount: number | null = null;
  private countAlias: string | null = null;
  private rawExternalRef: string | null = null;
  private readonly sourceTableName: string;
  private readonly alias: string;

  constructor(
    private readonly tableName: string,
    private readonly tables: TableMap
  ) {
    const parsed = FakeQueryBuilder.parseTableExpression(tableName);
    this.sourceTableName = parsed.tableName;
    this.alias = parsed.alias;
  }

  private static parseTableExpression(tableExpression: string): { tableName: string; alias: string } {
    const asMatch = tableExpression.match(/^(.+?)\s+as\s+(.+)$/i);
    if (asMatch) {
      return { tableName: asMatch[1].trim(), alias: asMatch[2].trim() };
    }

    const parts = tableExpression.trim().split(/\s+/);
    if (parts.length === 2) {
      return { tableName: parts[0], alias: parts[1] };
    }

    return { tableName: tableExpression.trim(), alias: tableExpression.trim() };
  }

  where(columnOrConditions: string | Record<string, any>, operatorOrValue?: any, value?: any): this {
    if (typeof columnOrConditions === 'string') {
      if (arguments.length === 3) {
        this.comparisons.push({ column: columnOrConditions, operator: operatorOrValue, value });
      } else {
        this.conditions[columnOrConditions] = operatorOrValue;
      }
    } else {
      Object.assign(this.conditions, columnOrConditions);
    }

    return this;
  }

  andWhere(columnOrConditions: string | Record<string, any>, operatorOrValue?: any, value?: any): this {
    if (arguments.length === 3) {
      return this.where(columnOrConditions as any, operatorOrValue, value);
    }
    return this.where(columnOrConditions as any, operatorOrValue);
  }

  andWhereRaw(sql: string, bindings: any[]): this {
    if (sql.includes("attributes->>'external_ref'")) {
      this.rawExternalRef = String(bindings[0]);
    }
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderings.push({ column, direction });
    return this;
  }

  select(...columns: string[]): this {
    this.selectedColumns.push(...columns);
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  count(expression: string): this {
    const match = expression.match(/\s+as\s+(.+)$/i);
    this.countAlias = match?.[1]?.trim() ?? 'count';
    return this;
  }

  join(tableExpression: string, callback: (join: any) => void): this {
    const parsed = FakeQueryBuilder.parseTableExpression(tableExpression);
    const clauses: Array<{ left: string; operator: string; right: string }> = [];
    const joinClause = {
      on: (left: string, operator: string, right: string) => {
        clauses.push({ left, operator, right });
        return joinClause;
      },
      andOn: (left: string, operator: string, right: string) => {
        clauses.push({ left, operator, right });
        return joinClause;
      },
    };
    callback.call(joinClause, joinClause);
    this.joins.push({ tableName: parsed.tableName, alias: parsed.alias, clauses });
    return this;
  }

  leftJoin(tableExpression: string, callback: (join: any) => void): this {
    return this.join(tableExpression, callback);
  }

  clone(): FakeQueryBuilder {
    const cloned = new FakeQueryBuilder(this.tableName, this.tables);
    cloned.conditions = { ...this.conditions };
    cloned.comparisons = [...this.comparisons];
    cloned.orderings = [...this.orderings];
    cloned.joins = this.joins.map((join) => ({ ...join, clauses: [...join.clauses] }));
    cloned.selectedColumns = [...this.selectedColumns];
    cloned.limitCount = this.limitCount;
    cloned.countAlias = this.countAlias;
    cloned.rawExternalRef = this.rawExternalRef;
    return cloned;
  }

  whereExists(): this {
    return this;
  }

  then<TResult1 = TableRow[], TResult2 = never>(
    onfulfilled?: ((value: TableRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  async first(): Promise<TableRow | undefined> {
    return this.execute()[0];
  }

  async update(updateData: Record<string, any>): Promise<number> {
    const rows = (this.tables[this.sourceTableName] ?? [])
      .filter((row) => this.matches(this.qualifyRow(row, this.alias)));
    runtimeState.dbUpdates.push({
      tableName: this.tableName,
      conditions: { ...this.conditions },
      updateData: { ...updateData },
    });
    rows.forEach((row) => Object.assign(row, updateData));
    return rows.length;
  }

  async delete(): Promise<number> {
    const rows = this.tables[this.sourceTableName] ?? [];
    const remaining = rows.filter((row) => !this.matches(this.qualifyRow(row, this.alias)));
    this.tables[this.sourceTableName] = remaining;
    return rows.length - remaining.length;
  }

  async insert(data: Record<string, any> | Array<Record<string, any>>): Promise<any> {
    const rows = Array.isArray(data) ? data : [data];
    if (!this.tables[this.sourceTableName]) {
      this.tables[this.sourceTableName] = [];
    }
    this.tables[this.sourceTableName].push(...rows);
    return rows;
  }

  private qualifyRow(row: TableRow, alias: string): TableRow {
    return Object.fromEntries(Object.entries(row).flatMap(([key, value]) => [[key, value], [`${alias}.${key}`, value]]));
  }

  private valueFor(row: TableRow, column: string): any {
    return row[column] ?? row[column.split('.').pop() ?? column];
  }

  private matches(row: TableRow): boolean {
    return Object.entries(this.conditions).every(([column, value]) => this.valueFor(row, column) === value)
      && this.comparisons.every(({ column, operator, value }) => {
        const rowValue = this.valueFor(row, column);
        if (operator === '>') {
          return rowValue > value;
        }
        if (operator === '>=') {
          return rowValue >= value;
        }
        if (operator === '<') {
          return rowValue < value;
        }
        if (operator === '<=') {
          return rowValue <= value;
        }
        return rowValue === value;
      })
      && (!this.rawExternalRef || this.valueFor(row, 'attributes')?.external_ref === this.rawExternalRef);
  }

  private joinMatches(row: TableRow, clauses: Array<{ left: string; operator: string; right: string }>): boolean {
    return clauses.every(({ left, operator, right }) => {
      if (operator !== '=') {
        return false;
      }
      return this.valueFor(row, left) === this.valueFor(row, right);
    });
  }

  private applyJoins(rows: TableRow[]): TableRow[] {
    return this.joins.reduce((currentRows, join) => {
      const joinRows = this.tables[join.tableName] ?? [];
      return currentRows.flatMap((currentRow) => joinRows
        .map((joinRow) => ({ ...currentRow, ...this.qualifyRow(joinRow, join.alias) }))
        .filter((combinedRow) => this.joinMatches(combinedRow, join.clauses)));
    }, rows);
  }

  private project(row: TableRow): TableRow {
    if (this.selectedColumns.length === 0) {
      return row;
    }

    return Object.fromEntries(this.selectedColumns.map((column) => {
      const aliasMatch = column.match(/^(.+?)\s+as\s+(.+)$/i);
      if (aliasMatch) {
        return [aliasMatch[2].trim(), this.valueFor(row, aliasMatch[1].trim())];
      }
      return [column.split('.').pop() ?? column, this.valueFor(row, column)];
    }));
  }

  private execute(): TableRow[] {
    const baseRows = [...(this.tables[this.sourceTableName] ?? [])].map((row) => this.qualifyRow(row, this.alias));
    const rows = this.applyJoins(baseRows).filter((row) => this.matches(row));

    if (this.countAlias) {
      return [{ [this.countAlias]: rows.length }];
    }

    const orderedRows = rows.sort((left, right) => {
      for (const ordering of this.orderings) {
        const leftValue = this.valueFor(left, ordering.column);
        const rightValue = this.valueFor(right, ordering.column);

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

    const limitedRows = this.limitCount === null ? orderedRows : orderedRows.slice(0, this.limitCount);
    return limitedRows.map((row) => this.project(row));
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

const findIds = {
  ticketId: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  contactId: '33333333-3333-4333-8333-333333333333',
  statusId: '44444444-4444-4444-8444-444444444444',
  priorityId: '55555555-5555-4555-8555-555555555555',
  categoryId: '66666666-6666-4666-8666-666666666666',
  subcategoryId: '77777777-7777-4777-8777-777777777777',
  assignedTo: '88888888-8888-4888-8888-888888888888',
  comment1: '99999999-9999-4999-8999-999999999991',
  comment2: '99999999-9999-4999-8999-999999999992',
  comment3: '99999999-9999-4999-8999-999999999993',
  attachment1: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  attachment2: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  file1: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  file2: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
};

function createFindTicket(overrides: TableRow = {}): TableRow {
  return {
    tenant: 'tenant-1',
    ticket_id: findIds.ticketId,
    ticket_number: 'T-100',
    title: 'Workflow lookup ticket',
    url: null,
    company_id: findIds.companyId,
    contact_name_id: findIds.contactId,
    status_id: findIds.statusId,
    priority_id: findIds.priorityId,
    category_id: findIds.categoryId,
    subcategory_id: findIds.subcategoryId,
    assigned_to: findIds.assignedTo,
    entered_at: '2026-03-10T09:00:00.000Z',
    updated_at: '2026-03-11T09:00:00.000Z',
    closed_at: null,
    is_closed: false,
    response_state: 'awaiting_client',
    attributes: {},
    ...overrides,
  };
}

function createFindComments(): TableRow[] {
  return [
    {
      tenant: 'tenant-1',
      ticket_id: findIds.ticketId,
      comment_id: findIds.comment1,
      note: 'Oldest comment',
      is_internal: false,
      is_resolution: false,
      is_initial_description: false,
      created_at: '2026-03-10T10:00:00.000Z',
      user_id: null,
      contact_id: findIds.contactId,
      author_type: 'contact',
    },
    {
      tenant: 'tenant-1',
      ticket_id: findIds.ticketId,
      comment_id: findIds.comment2,
      note: 'Middle comment',
      is_internal: true,
      is_resolution: false,
      is_initial_description: false,
      created_at: '2026-03-10T11:00:00.000Z',
      user_id: findIds.assignedTo,
      contact_id: null,
      author_type: 'internal',
    },
    {
      tenant: 'tenant-1',
      ticket_id: findIds.ticketId,
      comment_id: findIds.comment3,
      note: 'Newest comment',
      is_internal: false,
      is_resolution: false,
      is_initial_description: false,
      created_at: '2026-03-10T12:00:00.000Z',
      user_id: null,
      contact_id: findIds.contactId,
      author_type: 'contact',
    },
  ];
}

describe('ticket workflow runtime board-scoped statuses', () => {
  beforeEach(() => {
    runtimeState.registeredActions.length = 0;
    runtimeState.currentTenantTx = null;
    runtimeState.createTicketMock.mockReset();
    runtimeState.updateTicketMock.mockReset();
    runtimeState.createCommentMock.mockReset();
    runtimeState.dbUpdates.length = 0;
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
          attributes: {},
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
    expect(tables.tickets[0]?.attributes).toMatchObject({
      resolution_code: 'resolved',
      resolution_text: null,
    });

    const ticketUpdate = runtimeState.dbUpdates.find(
      (update) => update.tableName === 'tickets' && update.conditions.ticket_id === 'ticket-1'
    );
    expect(ticketUpdate).toBeDefined();
    expect(ticketUpdate?.updateData).toEqual(expect.not.objectContaining({
      resolution_code: expect.anything(),
      root_cause: expect.anything(),
      workaround: expect.anything(),
      related_problem_id: expect.anything(),
      sla_target: expect.anything(),
      sla_breach: expect.anything(),
    }));
    expect(ticketUpdate?.updateData.attributes).toMatchObject({
      resolution_code: 'resolved',
      resolution_text: null,
    });
  });

  it('T039a: tickets.close preserves existing ticket attributes when storing resolution details', async () => {
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
          attributes: {
            existing_key: 'existing-value',
            custom_fields: { impact: 'high' },
          },
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
      ],
    };
    setTenantTx(tables);

    const action = getAction('tickets.close');

    await action.handler(
      {
        ticket_id: 'ticket-1',
        resolution: {
          code: 'fixed',
          text: 'Replaced the failing part',
        },
        public_note: 'Closing with resolution',
      },
      createActionContext()
    );

    expect(tables.tickets[0]?.attributes).toEqual({
      existing_key: 'existing-value',
      custom_fields: { impact: 'high' },
      resolution_code: 'fixed',
      resolution_text: 'Replaced the failing part',
    });
    expect(runtimeState.createCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_resolution: true,
        metadata: expect.objectContaining({
          closes_ticket: true,
          source: 'workflow',
          run_id: 'run-1',
          step_path: 'step-1',
        }),
      }),
      'tenant-1',
      expect.any(Function),
      undefined,
      undefined,
      'user-1'
    );
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

  it('T042: tickets.find returns response_state in the ticket summary', async () => {
    setTenantTx({
      tickets: [createFindTicket()],
    });

    const action = getAction('tickets.find');
    const result = await action.handler(
      {
        ticket_id: findIds.ticketId,
        response_state: 'awaiting_client',
      },
      createActionContext()
    );

    expect(result.ticket.response_state).toBe('awaiting_client');
  });

  it('T043: tickets.find returns oldest comments first by default with truncation metadata', async () => {
    setTenantTx({
      tickets: [createFindTicket()],
      comments: createFindComments(),
    });

    const action = getAction('tickets.find');
    const result = await action.handler(
      {
        ticket_id: findIds.ticketId,
        include: {
          comments: true,
          comments_limit: 2,
        },
      },
      createActionContext()
    );

    // Default stays asc: published v1 definitions rely on comments[0] being
    // the oldest comment; newest-first is an explicit opt-in.
    expect(result.comments.map((comment: TableRow) => comment.note)).toEqual(['Oldest comment', 'Middle comment']);
    expect(result.comments_meta).toEqual({
      total_count: 3,
      returned_count: 2,
      truncated: true,
    });
  });

  it('T044: tickets.find supports descending comment order', async () => {
    setTenantTx({
      tickets: [createFindTicket()],
      comments: createFindComments(),
    });

    const action = getAction('tickets.find');
    const result = await action.handler(
      {
        ticket_id: findIds.ticketId,
        include: {
          comments: true,
          comments_order: 'desc',
        },
      },
      createActionContext()
    );

    expect(result.comments.map((comment: TableRow) => comment.note)).toEqual([
      'Newest comment',
      'Middle comment',
      'Oldest comment',
    ]);
    expect(result.comments_meta).toEqual({
      total_count: 3,
      returned_count: 3,
      truncated: false,
    });
  });

  it('T045: tickets.find filters comments created after an ISO timestamp', async () => {
    setTenantTx({
      tickets: [createFindTicket()],
      comments: createFindComments(),
    });

    const action = getAction('tickets.find');
    const result = await action.handler(
      {
        ticket_id: findIds.ticketId,
        include: {
          comments: true,
          comments_created_after: '2026-03-10T10:30:00.000Z',
          comments_order: 'asc',
        },
      },
      createActionContext()
    );

    expect(result.comments.map((comment: TableRow) => comment.note)).toEqual(['Middle comment', 'Newest comment']);
    expect(result.comments_meta).toEqual({
      total_count: 2,
      returned_count: 2,
      truncated: false,
    });
  });

  it('T046: tickets.find returns attachment metadata alongside bounded attachments', async () => {
    setTenantTx({
      tickets: [createFindTicket()],
      document_associations: [
        {
          tenant: 'tenant-1',
          entity_type: 'ticket',
          entity_id: findIds.ticketId,
          document_id: findIds.attachment1,
          created_at: '2026-03-10T13:00:00.000Z',
        },
        {
          tenant: 'tenant-1',
          entity_type: 'ticket',
          entity_id: findIds.ticketId,
          document_id: findIds.attachment2,
          created_at: '2026-03-10T14:00:00.000Z',
        },
      ],
      documents: [
        {
          tenant: 'tenant-1',
          document_id: findIds.attachment1,
          document_name: 'first.txt',
          file_id: findIds.file1,
          mime_type: 'text/plain',
        },
        {
          tenant: 'tenant-1',
          document_id: findIds.attachment2,
          document_name: 'second.txt',
          file_id: findIds.file2,
          mime_type: 'text/plain',
        },
      ],
    });

    const action = getAction('tickets.find');
    const result = await action.handler(
      {
        ticket_id: findIds.ticketId,
        include: {
          attachments: true,
          attachments_limit: 1,
        },
      },
      createActionContext()
    );

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      document_id: findIds.attachment1,
      document_name: 'first.txt',
    });
    expect(result.attachments_meta).toEqual({
      total_count: 2,
      returned_count: 1,
      truncated: true,
    });
  });
});
