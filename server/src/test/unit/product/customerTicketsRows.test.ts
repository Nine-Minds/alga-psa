import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), exportQueue: vi.fn(), read: vi.fn(), actor: vi.fn(), db: vi.fn(), user: { user_id: 'u', tenant: 'home' } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: mocks.gate }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/co-managed', () => ({
  getCoManagedTicketQueue: mocks.read, exportCoManagedTicketQueue: mocks.exportQueue, bulkHandBackCoManagedTickets: vi.fn(),
}));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: mocks.actor }));

import { exportCoManagedTicketQueueAction } from '../../../lib/actions/coManagedTicketQueueActions';

const row = (over: Record<string, unknown>, fields: Record<string, unknown>) => ({
  tenant: 'ws-a', relationshipId: 'rel-a', ticketId: 't-1', workspaceName: 'Acme', canHandBack: true, ...over, fields,
});

beforeEach(() => {
  Object.values(mocks).forEach(m => { if (typeof m === 'function') (m as any).mockReset?.(); });
  mocks.gate.mockResolvedValue(undefined);
  mocks.actor.mockResolvedValue({ kind: 'session' });
  mocks.db.mockResolvedValue({ knex: {} });
});

describe('exportCoManagedTicketQueueAction', () => {
  it('goes through the admitted export read with the request as given, behind the serves gate', async () => {
    mocks.exportQueue.mockResolvedValue([]);
    const request = { view: 'working' as const, workspaceTenant: 'ws-a', search: 'vpn', state: 'open' as const };
    await exportCoManagedTicketQueueAction(request);
    expect(mocks.gate).toHaveBeenCalledWith('co-managed', 'home', 'serves');
    expect(mocks.exportQueue).toHaveBeenCalledWith({}, { kind: 'session' }, request);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('refuses before any read when the capability is closed (kill switch)', async () => {
    mocks.gate.mockRejectedValue(new Error('unavailable'));
    await expect(exportCoManagedTicketQueueAction({ view: 'working' })).rejects.toThrow('unavailable');
    expect(mocks.exportQueue).not.toHaveBeenCalled();
  });

  it('never exports canHandBack or any field outside the fixed columns; a redacted field is blank', async () => {
    mocks.exportQueue.mockResolvedValue([
      row({}, { ticket_number: 'T-1', title: 'Printer down', status_name: 'Open', responsibility: 'msp', secret_note: 'LEAK', canHandBack: true }),
      // title redacted by the admitted read: the key is simply absent
      row({ ticketId: 't-2', canHandBack: false }, { ticket_number: 'T-2', status_name: 'Open' }),
    ]);
    const result = await exportCoManagedTicketQueueAction({ view: 'working' }) as { csv: string; rowCount: number; filename: string };
    const [header, first, second] = result.csv.replace('﻿', '').trim().split(/\r?\n/);
    expect(header).toBe('workspace_tenant,relationship_id,ticket_id,workspace_name,ticket_number,title,status_name,priority_name,is_closed,responsibility,entered_at,updated_at');
    expect(result.csv).not.toMatch(/canHandBack|can_hand_back|LEAK|secret_note/);
    expect(first).toContain('Printer down');
    expect(second).toContain('T-2');
    expect(second.split(',')[5]).toBe(''); // redacted title is blank, not a placeholder
    expect(result.rowCount).toBe(2);
    expect(result.filename).toBe('co-managed-working-tickets.csv');
  });

  it('identifies each row by workspace + relationship + ticket so colliding ticket numbers stay distinct', async () => {
    mocks.exportQueue.mockResolvedValue([
      row({ tenant: 'ws-a', relationshipId: 'rel-a', ticketId: 't-1' }, { ticket_number: '1001' }),
      row({ tenant: 'ws-b', relationshipId: 'rel-b', ticketId: 't-9' }, { ticket_number: '1001' }),
    ]);
    const { csv } = await exportCoManagedTicketQueueAction({ view: 'working' }) as { csv: string };
    expect(csv).toContain('ws-a,rel-a,t-1');
    expect(csv).toContain('ws-b,rel-b,t-9');
  });
});
