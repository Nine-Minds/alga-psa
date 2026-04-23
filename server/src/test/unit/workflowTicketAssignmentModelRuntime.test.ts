import { beforeEach, describe, expect, it, vi } from 'vitest';

type RegisteredAction = {
  id: string;
  inputSchema: any;
  handler: (input: any, ctx: any) => Promise<any>;
};

type TableRow = Record<string, any>;
type TableMap = Record<string, TableRow[]>;

type RuntimeState = {
  registeredActions: RegisteredAction[];
  currentTenantTx: {
    tenantId: string;
    actorUserId: string;
    trx: any;
  } | null;
  tables: TableMap;
  createTicketMock: ReturnType<typeof vi.fn>;
  updateTicketMock: ReturnType<typeof vi.fn>;
  createCommentMock: ReturnType<typeof vi.fn>;
};

const runtimeState = vi.hoisted<RuntimeState>(() => ({
  registeredActions: [],
  currentTenantTx: null,
  tables: {},
  createTicketMock: vi.fn(),
  updateTicketMock: vi.fn(),
  createCommentMock: vi.fn(),
}));

vi.mock('@shared/workflow/runtime/registries/actionRegistry', () => ({
  getActionRegistryV2: () => ({
    register: (action: RegisteredAction) => {
      runtimeState.registeredActions.push(action);
    },
    get: (id: string, _version?: number) =>
      runtimeState.registeredActions.find((action) => action.id === id),
  }),
}));

vi.mock('@shared/workflow/runtime/actions/businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/workflow/runtime/actions/businessOperations/shared')>();

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

vi.mock('@shared/models/ticketModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/models/ticketModel')>();

  return {
    TicketModel: {
      getDefaultStatusId: actual.TicketModel.getDefaultStatusId.bind(actual.TicketModel),
      createTicket: runtimeState.createTicketMock,
      updateTicket: runtimeState.updateTicketMock,
      createComment: runtimeState.createCommentMock,
    },
  };
});

vi.mock('@shared/workflow/runtime/registries/workflowEmailRegistry', () => ({
  getWorkflowEmailProvider: () => ({
    TenantEmailService: {
      getInstance: () => ({
        sendEmail: vi.fn().mockResolvedValue({ success: true }),
      }),
    },
    StaticTemplateProcessor: class StaticTemplateProcessor {},
  }),
}));

import { registerTicketActions } from '@shared/workflow/runtime/actions/businessOperations/tickets';

class FakeJoinClause {
  pairs: Array<{ left: string; right: string }> = [];

  on(left: string, right: string): this {
    this.pairs.push({ left, right });
    return this;
  }

  andOn(left: string, right: string): this {
    return this.on(left, right);
  }
}

class FakeQueryBuilder {
  private conditions: Array<{ column: string; value: any }> = [];
  private whereInConditions: Array<{ column: string; values: any[] }> = [];
  private notNullColumns: string[] = [];
  private orderings: Array<{ column: string; direction: 'asc' | 'desc' }> = [];
  private selectedColumns: string[] | null = null;
  private joinTableName: string | null = null;
  private joinPairs: Array<{ left: string; right: string }> = [];

  constructor(
    private readonly tableName: string,
    private readonly tables: TableMap
  ) {}

  where(columnOrConditions: string | Record<string, any>, value?: any): this {
    if (typeof columnOrConditions === 'string') {
      this.conditions.push({ column: columnOrConditions, value });
    } else {
      Object.entries(columnOrConditions).forEach(([column, entryValue]) => {
        this.conditions.push({ column, value: entryValue });
      });
    }

    return this;
  }

  andWhere(columnOrConditions: string | Record<string, any>, value?: any): this {
    return this.where(columnOrConditions, value);
  }

  whereIn(column: string, values: any[]): this {
    this.whereInConditions.push({ column, values });
    return this;
  }

  whereNotNull(column: string): this {
    this.notNullColumns.push(column);
    return this;
  }

  join(tableName: string, callback: (this: FakeJoinClause) => void): this {
    const clause = new FakeJoinClause();
    callback.call(clause);
    this.joinTableName = tableName;
    this.joinPairs = clause.pairs;
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderings.push({ column, direction });
    return this;
  }

  select(...columns: string[]): this {
    this.selectedColumns = columns.length > 0 ? columns : null;
    return this;
  }

  then<TResult1 = TableRow[], TResult2 = never>(
    onfulfilled?: ((value: TableRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  async first(): Promise<TableRow | undefined> {
    return this.execute()[0];
  }

  async delete(): Promise<number> {
    const table = this.tables[this.tableName] ?? [];
    const matchingRows = new Set(this.executeBaseRows());
    this.tables[this.tableName] = table.filter((row) => !matchingRows.has(row));
    return matchingRows.size;
  }

  async insert(data: TableRow | TableRow[]): Promise<TableRow[]> {
    const rows = Array.isArray(data) ? data : [data];
    const table = this.tables[this.tableName] ?? [];
    const inserted = rows.map((row, index) => ({
      assignment_id: row.assignment_id ?? `${this.tableName}-${table.length + index + 1}`,
      ...row,
    }));
    this.tables[this.tableName] = [...table, ...inserted];
    return inserted;
  }

  async update(updateData: TableRow): Promise<TableRow[]> {
    const rows = this.executeBaseRows();
    rows.forEach((row) => Object.assign(row, updateData));
    return rows;
  }

  private execute(): TableRow[] {
    const rows = this.joinTableName ? this.executeJoinedRows() : this.executeBaseRows();
    const sortedRows = rows.sort((left, right) => {
      for (const ordering of this.orderings) {
        const leftValue = this.getColumnValue(left, ordering.column);
        const rightValue = this.getColumnValue(right, ordering.column);

        if (leftValue === rightValue) continue;
        if (leftValue == null) return ordering.direction === 'asc' ? 1 : -1;
        if (rightValue == null) return ordering.direction === 'asc' ? -1 : 1;
        if (leftValue < rightValue) return ordering.direction === 'asc' ? -1 : 1;
        if (leftValue > rightValue) return ordering.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });

    if (!this.selectedColumns) {
      return sortedRows;
    }

    return sortedRows.map((row) => {
      const next: TableRow = {};
      this.selectedColumns?.forEach((column) => {
        next[this.selectKey(column)] = this.getColumnValue(row, column);
      });
      return next;
    });
  }

  private executeBaseRows(): TableRow[] {
    const rows = [...(this.tables[this.tableName] ?? [])];
    return rows.filter((row) => this.matches(row));
  }

  private executeJoinedRows(): TableRow[] {
    const leftRows = this.tables[this.tableName] ?? [];
    const rightRows = this.tables[this.joinTableName!] ?? [];
    const joined: TableRow[] = [];

    for (const leftRow of leftRows) {
      for (const rightRow of rightRows) {
        const joinMatches = this.joinPairs.every(({ left, right }) => {
          const leftValue = this.getColumnValueFromTables(leftRow, rightRow, left);
          const rightValue = this.getColumnValueFromTables(leftRow, rightRow, right);
          return leftValue === rightValue;
        });

        if (!joinMatches) continue;

        joined.push({
          ...leftRow,
          ...rightRow,
          ...this.prefixRow(this.tableName, leftRow),
          ...this.prefixRow(this.joinTableName!, rightRow),
        });
      }
    }

    return joined.filter((row) => this.matches(row));
  }

  private matches(row: TableRow): boolean {
    return this.conditions.every(({ column, value }) => this.getColumnValue(row, column) === value)
      && this.whereInConditions.every(({ column, values }) => values.includes(this.getColumnValue(row, column)))
      && this.notNullColumns.every((column) => this.getColumnValue(row, column) != null);
  }

  private prefixRow(prefix: string, row: TableRow): TableRow {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [`${prefix}.${key}`, value]));
  }

  private getColumnValue(row: TableRow, column: string): any {
    if (column in row) {
      return row[column];
    }

    const segments = column.split('.');
    return segments.length > 1 ? row[segments[segments.length - 1]] : row[column];
  }

  private getColumnValueFromTables(leftRow: TableRow, rightRow: TableRow, column: string): any {
    const [prefix, key] = column.includes('.') ? column.split('.', 2) : [this.tableName, column];
    if (prefix === this.tableName) {
      return leftRow[key];
    }
    if (prefix === this.joinTableName) {
      return rightRow[key];
    }
    return undefined;
  }

  private selectKey(column: string): string {
    const parts = column.split('.');
    return parts[parts.length - 1];
  }
}

function createFakeTrx(tables: TableMap) {
  return ((tableName: string) => new FakeQueryBuilder(tableName, tables)) as any;
}

function setTenantTx(tables: TableMap): void {
  runtimeState.tables = tables;
  runtimeState.currentTenantTx = {
    tenantId: 'tenant-1',
    actorUserId: 'actor-1',
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
    nowIso: () => '2026-04-20T00:00:00.000Z',
    env: {},
  };
}

const IDS = {
  client: '00000000-0000-0000-0000-000000000001',
  board: '00000000-0000-0000-0000-000000000002',
  priority: '00000000-0000-0000-0000-000000000003',
  ticket: '00000000-0000-0000-0000-000000000004',
  userOld: '00000000-0000-0000-0000-000000000010',
  user1: '00000000-0000-0000-0000-000000000011',
  user2: '00000000-0000-0000-0000-000000000012',
  userNew: '00000000-0000-0000-0000-000000000013',
  userC: '00000000-0000-0000-0000-000000000014',
  lead1: '00000000-0000-0000-0000-000000000015',
  member1: '00000000-0000-0000-0000-000000000016',
  member2: '00000000-0000-0000-0000-000000000017',
  userExtra: '00000000-0000-0000-0000-000000000018',
  team1: '00000000-0000-0000-0000-000000000019',
};

function activeInternalUser(userId: string): TableRow {
  return {
    tenant: 'tenant-1',
    user_id: userId,
    user_type: 'internal',
    is_inactive: false,
  };
}

describe('workflow ticket assignment model runtime', () => {
  beforeEach(() => {
    runtimeState.registeredActions.length = 0;
    runtimeState.currentTenantTx = null;
    runtimeState.tables = {};
    runtimeState.createTicketMock.mockReset();
    runtimeState.updateTicketMock.mockReset();
    runtimeState.createCommentMock.mockReset();

    runtimeState.createTicketMock.mockImplementation(async (input: any) => ({
      ticket_id: IDS.ticket,
      ticket_number: 'T-1',
      title: input.title,
      assigned_to: input.assigned_to ?? null,
      assigned_team_id: input.assigned_team_id ?? null,
      status_id: input.status_id ?? 'status-1',
      priority_id: input.priority_id ?? IDS.priority,
      entered_at: '2026-04-20T00:00:00.000Z',
      attributes: input.attributes ?? {},
    }));

    runtimeState.updateTicketMock.mockImplementation(async (ticketId: string, updateData: any, tenant: string) => {
      const table = runtimeState.tables.tickets ?? [];
      const ticket = table.find((row) => row.ticket_id === ticketId && row.tenant === tenant);
      if (ticket) {
        Object.assign(ticket, updateData, { updated_at: '2026-04-20T00:00:00.000Z' });
      }
      return {
        ...(ticket ?? { ticket_id: ticketId, tenant }),
        ...updateData,
        updated_at: '2026-04-20T00:00:00.000Z',
        attributes: updateData.attributes ?? ticket?.attributes ?? {},
      };
    });

    registerTicketActions();
  });

  it('T002: tickets.create with primary user plus additional users persists primary assignment and reconciles additional ticket resources deterministically', async () => {
    setTenantTx({
      users: [activeInternalUser(IDS.user1), activeInternalUser(IDS.user2)],
      ticket_resources: [],
    });

    const action = getAction('tickets.create');
    const result = await action.handler(
      {
        client_id: IDS.client,
        title: 'Workflow created ticket',
        description: 'Created from workflow',
        board_id: IDS.board,
        priority_id: IDS.priority,
        assignment: {
          primary: { type: 'user', id: IDS.user1 },
          additional_user_ids: [IDS.user1, IDS.user2, IDS.user2],
        },
      },
      createActionContext()
    );

    expect(runtimeState.createTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigned_to: IDS.user1,
        assigned_team_id: undefined,
      }),
      'tenant-1',
      expect.anything(),
      {},
      undefined,
      undefined,
      'actor-1'
    );
    expect(result.ticket_id).toBe(IDS.ticket);
    expect(runtimeState.tables.ticket_resources).toEqual([
      expect.objectContaining({
        ticket_id: IDS.ticket,
        assigned_to: IDS.user1,
        additional_user_id: IDS.user2,
        role: 'support',
      }),
    ]);
  });

  it('T003: tickets.create rejects non-empty additional_user_ids when assignment.primary is null', () => {
    const action = getAction('tickets.create');
    const parse = action.inputSchema.safeParse({
      client_id: IDS.client,
      title: 'Workflow created ticket',
      description: 'Created from workflow',
      board_id: IDS.board,
      priority_id: IDS.priority,
      assignment: {
        primary: null,
        additional_user_ids: [IDS.user2],
      },
    });

    expect(parse.success).toBe(false);
    expect(parse.error.issues.some((issue) => issue.message === 'additional_user_ids requires a primary assignment')).toBe(true);
  });

  it('T004: tickets.update_fields with patch.assignment atomically replaces both primary assignment and additional users', async () => {
    setTenantTx({
      tickets: [
        {
          tenant: 'tenant-1',
          ticket_id: IDS.ticket,
          board_id: IDS.board,
          title: 'Existing ticket',
          status_id: 'status-1',
          priority_id: IDS.priority,
          assigned_to: IDS.userOld,
          assigned_team_id: null,
          attributes: {},
          updated_at: '2026-04-19T00:00:00.000Z',
        },
      ],
      priorities: [{ tenant: 'tenant-1', priority_id: IDS.priority }],
      users: [
        activeInternalUser(IDS.userOld),
        activeInternalUser(IDS.userNew),
        activeInternalUser(IDS.userC),
      ],
      ticket_resources: [
        {
          tenant: 'tenant-1',
          ticket_id: IDS.ticket,
          assigned_to: IDS.userOld,
          additional_user_id: '00000000-0000-0000-0000-000000000021',
          role: 'support',
        },
        {
          tenant: 'tenant-1',
          ticket_id: IDS.ticket,
          assigned_to: IDS.userOld,
          additional_user_id: '00000000-0000-0000-0000-000000000022',
          role: 'support',
        },
      ],
    });

    const action = getAction('tickets.update_fields');
    const result = await action.handler(
      {
        ticket_id: IDS.ticket,
        patch: {
          assignment: {
            primary: { type: 'user', id: IDS.userNew },
            additional_user_ids: [IDS.userC],
          },
        },
      },
      createActionContext()
    );

    expect(result.ticket_id).toBe(IDS.ticket);
    expect(runtimeState.tables.tickets[0]).toMatchObject({
      assigned_to: IDS.userNew,
      assigned_team_id: null,
    });
    expect(runtimeState.tables.ticket_resources).toEqual([
      expect.objectContaining({
        ticket_id: IDS.ticket,
        assigned_to: IDS.userNew,
        additional_user_id: IDS.userC,
        role: 'support',
      }),
    ]);
  });

  it('T005: tickets.assign with team primary plus explicit additional_user_ids unions team expansion and explicit users, de-dupes, and excludes the resolved primary assignee', async () => {
    setTenantTx({
      tickets: [
        {
          tenant: 'tenant-1',
          ticket_id: IDS.ticket,
          assigned_to: IDS.userOld,
          assigned_team_id: null,
          updated_at: '2026-04-19T00:00:00.000Z',
        },
      ],
      teams: [
        {
          tenant: 'tenant-1',
          team_id: IDS.team1,
          manager_id: IDS.lead1,
        },
      ],
      team_members: [
        { tenant: 'tenant-1', team_id: IDS.team1, user_id: IDS.lead1, created_at: '2026-04-01T00:00:00.000Z' },
        { tenant: 'tenant-1', team_id: IDS.team1, user_id: IDS.member1, created_at: '2026-04-01T00:00:01.000Z' },
        { tenant: 'tenant-1', team_id: IDS.team1, user_id: IDS.member2, created_at: '2026-04-01T00:00:02.000Z' },
      ],
      users: [
        activeInternalUser(IDS.userOld),
        activeInternalUser(IDS.lead1),
        activeInternalUser(IDS.member1),
        activeInternalUser(IDS.member2),
        activeInternalUser(IDS.userExtra),
      ],
      ticket_resources: [
        {
          tenant: 'tenant-1',
          ticket_id: IDS.ticket,
          assigned_to: IDS.userOld,
          additional_user_id: '00000000-0000-0000-0000-000000000023',
          role: 'support',
        },
      ],
    });

    const action = getAction('tickets.assign');
    const result = await action.handler(
      {
        ticket_id: IDS.ticket,
        assignment: {
          primary: { type: 'team', id: IDS.team1 },
          additional_user_ids: [IDS.member2, IDS.userExtra, IDS.lead1],
        },
        no_op_if_already_assigned: false,
      },
      createActionContext()
    );

    expect(result.assigned_to).toBe(IDS.lead1);
    expect(runtimeState.tables.tickets[0]).toMatchObject({
      assigned_to: IDS.lead1,
      assigned_team_id: IDS.team1,
    });

    const additionalUsers = (runtimeState.tables.ticket_resources ?? [])
      .map((row) => ({ userId: row.additional_user_id, role: row.role }))
      .sort((left, right) => left.userId.localeCompare(right.userId));

    expect(additionalUsers).toEqual([
      { userId: IDS.member1, role: 'team_member' },
      { userId: IDS.member2, role: 'team_member' },
      { userId: IDS.userExtra, role: 'support' },
    ]);
  });
});
