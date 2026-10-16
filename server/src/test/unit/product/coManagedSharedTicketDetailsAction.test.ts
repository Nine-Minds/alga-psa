import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ screen: vi.fn(), details: vi.fn(), editor: vi.fn(), options: vi.fn(), db: vi.fn(), session: vi.fn(), override: vi.fn(),
  user: { user_id: 'msp-user', tenant: 'msp-tenant', user_type: 'internal' }, knex: {}, Forbidden: class extends Error {}, Setup: class extends Error {} }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db, tenantDb: vi.fn(), withTransaction: (_knex: unknown, work: (trx: unknown) => unknown) => work({}) }));
vi.mock('@alga-psa/co-managed', () => ({ getCoManagedTicketScreen: mocks.screen, getCoManagedSharedTicketDetails: mocks.details, getCoManagedTicketEditor: mocks.editor,
  searchCoManagedTicketEditOptions: mocks.options, CoManagedSharedWorkError: mocks.Forbidden, CoManagedSlaSetupError: mocks.Setup }));
vi.mock('@alga-psa/licensing', () => ({ isCoManagedLifecycleError: () => false }));
import { getSharedTicketDetailsAction } from '../../../lib/actions/coManagedSharedWorkActions';
const resource = { tenant: 'customer-tenant', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.db.mockResolvedValue({ knex: mocks.knex });
  mocks.session.mockResolvedValue({ session_id: 'tracked-session', user: { id: 'msp-user', tenant: 'msp-tenant', user_type: 'internal' } });
});
it('composes the admitted screen, details and editor reads and degrades pickers for non-editable fields', async () => {
  mocks.screen.mockResolvedValue({ summary: { resource, revision: 1, fields: { title: 'T' } }, sla: {}, side: 'sponsor', customerName: 'C', sponsorName: 'S',
    destinationName: undefined, canWrite: true, canEscalate: false, canHandBack: false, canRevoke: false });
  mocks.details.mockResolvedValue({ resource, revision: 1, fields: {} });
  mocks.editor.mockResolvedValue({ resource, values: { title: 'T' }, editableFields: ['status_id'], selectedOptions: {} });
  mocks.options.mockResolvedValue({ options: [{ id: 's', name: 'Open' }], nextAfterId: null });
  const result = await getSharedTicketDetailsAction(resource);
  const actor = { kind: 'session', tenant: 'msp-tenant', userId: 'msp-user', sessionId: 'tracked-session' };
  expect(mocks.details).toHaveBeenCalledWith(mocks.knex, actor, resource);
  expect(mocks.options).toHaveBeenCalledTimes(1);
  expect(mocks.options).toHaveBeenCalledWith(mocks.knex, actor, resource, { field: 'status_id' });
  expect(result.ticketData.options.status).toEqual([{ value: 's', label: 'Open', board_id: null }]);
  expect(result.ticketData.options.priority).toEqual([]);
  expect(result.editor.baselines).toEqual({ status_id: null });
});
it('fails fast for non-ticket resources and propagates denial', async () => {
  await expect(getSharedTicketDetailsAction({ ...resource, kind: 'project' as const })).rejects.toBeInstanceOf(mocks.Forbidden);
  mocks.screen.mockRejectedValue(new mocks.Forbidden());
  await expect(getSharedTicketDetailsAction(resource)).rejects.toBeInstanceOf(mocks.Forbidden);
  expect(mocks.details).not.toHaveBeenCalled();
});
