import { describe, expect, it, vi } from 'vitest';
import { createTicketQuerySchema } from '@alga-psa/tickets/lib/ticketQuerySchema';
import { validateClause } from '@alga-psa/predicates';

vi.mock('@alga-psa/core/capability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/core/capability')>()),
  isCapabilityServed: vi.fn(async () => true),
}));
vi.mock('./../seatNotifications', () => ({ coManagedSeatNotificationsServed: vi.fn(() => true) }));

import { coManagedSeatListViewProvider, coManagedSeatTicketListViews } from '../seatTicketListViews';

const TENANT = '11111111-1111-4111-8111-111111111111';
const seatFacts = (state = 'active') => ({ resolverFacts: { 'co-managed-seat': {
  assignments: [{ arrangement_id: 'a', state }],
  arrangements: [{ arrangement_id: 'a', client_id: 'c', state: 'active' }],
  boards: [{ arrangement_id: 'a', board_id: 'b', can_create: false }], projects: [] } } });

describe('seat ticket list view builder', () => {
  it('declares the four views in order, each clause valid against the ticket query schema', () => {
    const views = coManagedSeatTicketListViews();
    expect(views.map((v) => v.key)).toEqual(['client_it', 'msp', 'unassigned', 'all']);
    expect(views.map((v) => v.defaultLabel)).toEqual(['Client IT', 'With MSP', 'Unassigned', 'All']);
    const schema = createTicketQuerySchema();
    for (const view of views) for (const clause of view.clauses) expect(validateClause(schema, clause)).toBeNull();
    expect(views[3].clauses).toEqual([]);
  });

  it('carries no client or board scope: scope is the read authorization, which a view only narrows', () => {
    const paths = coManagedSeatTicketListViews().flatMap((v) => v.clauses.map((c) => c.path));
    expect(paths.filter((p) => /client|board/.test(p))).toEqual([]);
  });

  it('offers views to a seat technician with a live scope', async () => {
    expect((await coManagedSeatListViewProvider({ tenant: TENANT, subject: seatFacts() }))?.length).toBe(4);
  });

  it('offers nothing to a subject with no seat facts, without a gate check', async () => {
    expect(await coManagedSeatListViewProvider({ tenant: TENANT, subject: {} })).toBeNull();
  });

  it('offers nothing to a seat technician whose assignment is not live', async () => {
    expect(await coManagedSeatListViewProvider({ tenant: TENANT, subject: seatFacts('revoked') })).toBeNull();
  });
});
