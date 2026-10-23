/**
 * alga-2026-0002502 — `tickets.add_checklist_items` v1: schema, permission, and
 * that the insert goes through the shared core with source='workflow'.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Registered = { id: string; version: number; inputSchema: { parse: (v: unknown) => any; safeParse: (v: unknown) => any }; handler: (input: any, ctx: any) => Promise<any> };
const registered: Registered[] = [];

const requirePermissionMock = vi.fn();
const writeRunAuditMock = vi.fn();
const addItemsMock = vi.fn();
const ticketFirstMock = vi.fn();

const TENANT = '91a53464-0b67-4e3f-ae88-922d9c5af6ed';
const TICKET = 'd410d992-4e99-43e7-9390-f6b0ff744509';
const tx = { tenantId: TENANT, trx: { fake: true }, actorUserId: 'user-1' };

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ where: () => ({ first: () => ticketFirstMock() }) }) }),
}));

vi.mock('../../../registries/actionRegistry', () => ({
  getActionRegistryV2: () => ({ register: (a: Registered) => registered.push(a) }),
}));

vi.mock('../../../../../lib/ticketChecklists', () => ({
  addChecklistItemsToTicket: (...a: unknown[]) => addItemsMock(...a),
  applyChecklistTemplateToTicket: vi.fn(),
}));

vi.mock('../shared', async () => {
  const actual = await vi.importActual<typeof import('../shared')>('../shared');
  return {
    ...actual,
    withTenantTransaction: async (_ctx: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    requirePermission: (...a: unknown[]) => requirePermissionMock(...a),
    writeRunAudit: (...a: unknown[]) => writeRunAuditMock(...a),
  };
});

const ctx = { tenantId: TENANT, runId: 'run-1', stepPath: 'root.steps[1]' };

async function getAction() {
  registered.length = 0;
  const { registerTicketActions } = await import('../tickets');
  registerTicketActions();
  const action = registered.find((a) => a.id === 'tickets.add_checklist_items');
  expect(action).toBeDefined();
  return action!;
}

vi.setConfig({ testTimeout: 30000 });

describe('tickets.add_checklist_items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue(undefined);
    ticketFirstMock.mockResolvedValue({ ticket_id: TICKET });
    addItemsMock.mockResolvedValue([{ checklist_item_id: 'c1', item_name: 'A' }]);
  });

  it('registers as v1 and validates the input schema', async () => {
    const action = await getAction();
    expect(action.version).toBe(1);
    expect(action.inputSchema.safeParse({ ticket_id: TICKET, items: [] }).success).toBe(false);
    expect(action.inputSchema.safeParse({ ticket_id: TICKET, items: [{ item_name: '  ' }] }).success).toBe(false);
    expect(action.inputSchema.safeParse({ ticket_id: 'nope', items: [{ item_name: 'A' }] }).success).toBe(false);
    const parsed = action.inputSchema.parse({ ticket_id: TICKET, items: [{ item_name: 'A' }] });
    expect(parsed.items[0].is_required).toBe(false);
  });

  it('requires ticket:update and inserts with source=workflow', async () => {
    const action = await getAction();
    const input = action.inputSchema.parse({ ticket_id: TICKET, items: [{ item_name: 'A', description: 'd', is_required: true }] });
    const out = await action.handler(input, ctx);

    expect(requirePermissionMock).toHaveBeenCalledWith(ctx, tx, { resource: 'ticket', action: 'update' });
    expect(addItemsMock).toHaveBeenCalledWith(tx.trx, TENANT, TICKET, input.items, { source: 'workflow', createdBy: 'user-1' });
    expect(out).toEqual({ ticket_id: TICKET, added: [{ checklist_item_id: 'c1', item_name: 'A' }] });
    expect(writeRunAuditMock).toHaveBeenCalled();
  });

  it('writes nothing when ticket:update is denied', async () => {
    requirePermissionMock.mockRejectedValue({ code: 'PERMISSION_DENIED' });
    const action = await getAction();
    await expect(
      action.handler(action.inputSchema.parse({ ticket_id: TICKET, items: [{ item_name: 'A' }] }), ctx)
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(addItemsMock).not.toHaveBeenCalled();
  });
});
