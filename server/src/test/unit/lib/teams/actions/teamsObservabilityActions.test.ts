import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  hasPermissionMock: vi.fn(async () => true),
  createTenantKnexMock: vi.fn(),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => hoisted.hasPermissionMock(...args),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (fn: any) =>
    (...args: unknown[]) =>
      fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-a' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => hoisted.createTenantKnexMock(...args),
}));

import { listTeamsDeliveries } from '@alga-psa/ee-microsoft-teams/lib/actions/integrations/teamsObservabilityActions';
import {
  decodeTeamsObservabilityCursor,
  encodeTeamsObservabilityCursor,
  listTeamsAuditEventsImpl,
  listTeamsDeliveriesImpl,
} from '@alga-psa/ee-microsoft-teams/lib/actions/integrations/teamsObservabilityTypes';

type Predicate = (row: Record<string, any>) => boolean;

function valueForCompare(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function compareValue(rowValue: unknown, operator: string, expected: unknown): boolean {
  const left = valueForCompare(rowValue);
  const right = valueForCompare(expected);
  if (operator === '=') return left === right;
  if (operator === '<') return left < right;
  if (operator === '>=') return left >= right;
  throw new Error(`Unsupported operator ${operator}`);
}

class PredicateBuilder {
  private predicate: Predicate = () => true;

  where(column: string, operatorOrValue: unknown, maybeValue?: unknown): this {
    const operator = maybeValue === undefined ? '=' : String(operatorOrValue);
    const expected = maybeValue === undefined ? operatorOrValue : maybeValue;
    const previous = this.predicate;
    this.predicate = (row) => previous(row) && compareValue(row[column], operator, expected);
    return this;
  }

  andWhere(column: string, operatorOrValue: unknown, maybeValue?: unknown): this {
    return this.where(column, operatorOrValue, maybeValue);
  }

  orWhere(callback: (builder: PredicateBuilder) => void): this {
    const branch = new PredicateBuilder();
    callback(branch);
    const previous = this.predicate;
    const branchPredicate = branch.toPredicate();
    this.predicate = (row) => previous(row) || branchPredicate(row);
    return this;
  }

  toPredicate(): Predicate {
    return this.predicate;
  }
}

function makeKnex(tables: Record<string, Array<Record<string, any>>>) {
  function makeBuilder(tableName: string) {
    const predicates: Predicate[] = [];
    const orderings: Array<{ column: string; direction: string }> = [];
    let rowLimit: number | null = null;

    const builder: any = {
      where(criteriaOrColumn: Record<string, unknown> | string, operatorOrValue?: unknown, maybeValue?: unknown) {
        if (typeof criteriaOrColumn === 'string') {
          const operator = maybeValue === undefined ? '=' : String(operatorOrValue);
          const expected = maybeValue === undefined ? operatorOrValue : maybeValue;
          predicates.push((row) => compareValue(row[criteriaOrColumn], operator, expected));
        } else {
          predicates.push((row) =>
            Object.entries(criteriaOrColumn).every(([key, value]) => compareValue(row[key], '=', value))
          );
        }
        return builder;
      },
      andWhere(criteriaOrColumn: Record<string, unknown> | string | ((builder: PredicateBuilder) => void), operatorOrValue?: unknown, maybeValue?: unknown) {
        if (typeof criteriaOrColumn === 'function') {
          const predicateBuilder = new PredicateBuilder();
          criteriaOrColumn(predicateBuilder);
          predicates.push(predicateBuilder.toPredicate());
          return builder;
        }
        return builder.where(criteriaOrColumn, operatorOrValue, maybeValue);
      },
      modify(callback: (query: any) => void) {
        callback(builder);
        return builder;
      },
      orderBy(column: string, direction: string) {
        orderings.push({ column, direction });
        return builder;
      },
      limit(value: number) {
        rowLimit = value;
        return builder;
      },
      then(resolve: (rows: Array<Record<string, any>>) => unknown, reject?: (error: unknown) => unknown) {
        const source = [...(tables[tableName] ?? [])];
        let rows = source.filter((row) => predicates.every((predicate) => predicate(row)));
        rows.sort((left, right) => {
          for (const ordering of orderings) {
            const leftValue = valueForCompare(left[ordering.column]);
            const rightValue = valueForCompare(right[ordering.column]);
            if (leftValue === rightValue) continue;
            const result = leftValue < rightValue ? -1 : 1;
            return ordering.direction === 'desc' ? -result : result;
          }
          return 0;
        });
        if (rowLimit !== null) {
          rows = rows.slice(0, rowLimit);
        }
        return Promise.resolve(rows).then(resolve, reject);
      },
    };

    return builder;
  }

  return vi.fn((tableName: string) => makeBuilder(tableName));
}

function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 'tenant-a',
    delivery_id: 'delivery-001',
    internal_notification_id: 'notification-1',
    category: 'assignment',
    destination_type: 'user_activity',
    destination_id: 'user-1',
    attempt_number: 1,
    idempotency_key: 'key-1',
    provider_message_id: null,
    status: 'delivered',
    error_code: null,
    error_message: null,
    retryable: null,
    provider_request_id: null,
    sent_at: null,
    delivered_at: null,
    responded_at: null,
    created_at: '2026-05-24T10:00:00.000Z',
    ...overrides,
  };
}

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 'tenant-a',
    event_id: 'event-001',
    actor_user_id: 'user-1',
    microsoft_user_id: 'aad-user-1',
    surface: 'bot',
    action_id: 'assign_ticket',
    target_type: 'ticket',
    target_id: 'ticket-1',
    idempotency_key: null,
    payload_hash: 'hash-1',
    result_status: 'success',
    error_code: null,
    created_at: '2026-05-24T10:00:00.000Z',
    ...overrides,
  };
}

describe('Teams observability actions', () => {
  beforeEach(() => {
    hoisted.hasPermissionMock.mockReset();
    hoisted.hasPermissionMock.mockResolvedValue(true);
    hoisted.createTenantKnexMock.mockReset();
  });

  it('encodes and validates opaque created_at/id cursors', () => {
    const cursor = encodeTeamsObservabilityCursor('2026-05-24T10:00:00.000Z', 'row-1');
    expect(decodeTeamsObservabilityCursor(cursor)).toEqual({
      createdAt: '2026-05-24T10:00:00.000Z',
      id: 'row-1',
    });
    expect(() => decodeTeamsObservabilityCursor('not a cursor')).toThrow('Malformed Teams observability cursor');
  });

  it('lists delivery rows only for the authenticated tenant and clamps limit to 200', async () => {
    const rows = Array.from({ length: 250 }, (_, index) =>
      deliveryRow({
        delivery_id: `delivery-${String(index).padStart(3, '0')}`,
        created_at: `2026-05-24T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
      })
    );
    rows.push(deliveryRow({ tenant: 'tenant-b', delivery_id: 'delivery-cross-tenant' }));
    const knex = makeKnex({ teams_notification_deliveries: rows });
    hoisted.createTenantKnexMock.mockResolvedValue({ knex, tenant: 'tenant-a' });

    const page = await listTeamsDeliveriesImpl(
      { user_id: 'user-1', user_type: 'internal' },
      { tenant: 'tenant-a' },
      { limit: 1000 }
    );

    expect(page.rows).toHaveLength(200);
    expect(page.rows.every((row) => row.tenant === 'tenant-a')).toBe(true);
    expect(page.nextCursor).toBeTruthy();
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'teams_integration',
      'read',
      knex
    );
  });

  it('uses the cursor tuple for stable delivery pagination without overlap', async () => {
    const knex = makeKnex({
      teams_notification_deliveries: [
        deliveryRow({ delivery_id: 'delivery-003', created_at: '2026-05-24T10:00:00.000Z' }),
        deliveryRow({ delivery_id: 'delivery-002', created_at: '2026-05-24T10:00:00.000Z' }),
        deliveryRow({ delivery_id: 'delivery-001', created_at: '2026-05-24T10:00:00.000Z' }),
        deliveryRow({ delivery_id: 'delivery-000', created_at: '2026-05-24T09:59:00.000Z' }),
      ],
    });
    hoisted.createTenantKnexMock.mockResolvedValue({ knex, tenant: 'tenant-a' });

    const first = await listTeamsDeliveriesImpl({}, { tenant: 'tenant-a' }, { limit: 2 });
    const second = await listTeamsDeliveriesImpl({}, { tenant: 'tenant-a' }, { limit: 2, cursor: first.nextCursor ?? undefined });

    expect(first.rows.map((row) => row.delivery_id)).toEqual(['delivery-003', 'delivery-002']);
    expect(second.rows.map((row) => row.delivery_id)).toEqual(['delivery-001', 'delivery-000']);
  });

  it('rejects callers without teams_integration:read', async () => {
    const knex = makeKnex({ teams_notification_deliveries: [] });
    hoisted.createTenantKnexMock.mockResolvedValue({ knex, tenant: 'tenant-a' });
    hoisted.hasPermissionMock.mockResolvedValue(false);

    await expect(listTeamsDeliveries({}, { tenant: 'tenant-a' })).rejects.toThrow('Forbidden');
  });

  it('filters audit events by tenant and documented filter parameters', async () => {
    const knex = makeKnex({
      teams_audit_events: [
        auditRow({ event_id: 'event-003', actor_user_id: 'user-1', result_status: 'success' }),
        auditRow({ event_id: 'event-002', actor_user_id: 'user-2', result_status: 'success' }),
        auditRow({ event_id: 'event-001', actor_user_id: 'user-1', result_status: 'failure' }),
        auditRow({ tenant: 'tenant-b', event_id: 'event-cross-tenant', actor_user_id: 'user-1' }),
      ],
    });
    hoisted.createTenantKnexMock.mockResolvedValue({ knex, tenant: 'tenant-a' });

    const page = await listTeamsAuditEventsImpl(
      { user_id: 'user-1', user_type: 'internal' },
      { tenant: 'tenant-a' },
      {
        surface: 'bot',
        action_id: 'assign_ticket',
        actor_user_id: 'user-1',
        result_status: 'success',
      }
    );

    expect(page.rows.map((row) => row.event_id)).toEqual(['event-003']);
  });
});
