import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), statuses: vi.fn() }));
vi.mock('@alga-psa/client-portal/actions', () => ({ getClientTicketDetails: mocks.read }));
vi.mock('@alga-psa/reference-data/actions', () => ({ getTicketStatuses: mocks.statuses }));
vi.mock('@alga-psa/client-portal/components', () => ({ TicketDetailsContainer: () => null }));
vi.mock('@/lib/productAccess', () => ({ getCurrentTenantProduct: async () => 'psa' }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: async () => ({ t: (_key: string, options: any) => options?.defaultValue ?? _key }) }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: () => null, AlertDescription: () => null }));
vi.mock('@alga-psa/core/logger', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ getErrorMessage: (value: any) => value.actionError ?? value.permissionError,
  isActionMessageError: (value: any) => Boolean(value?.actionError), isActionPermissionError: (value: any) => Boolean(value?.permissionError) }));
import TicketPage from '../../../app/client-portal/tickets/[ticketId]/page';
const page = (query: Record<string, string | string[] | undefined>) => TicketPage({ params: Promise.resolve({ ticketId: 'ticket' }), searchParams: Promise.resolve(query) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.statuses.mockResolvedValue([]);
  mocks.read.mockImplementation(async (_ticket, conversation) => ({ tenant: 'owner', ticket_id: 'ticket', board_id: 'board', selectedConversationId: conversation ?? 'default' }));
});
it('loads the selected requester conversation through the existing authorized action', async () => {
  const result = await page({ tenant: 'portal-slug', conversation: 'delivery', conversationStore: 'owner', message: 'message' });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith('ticket', 'delivery');
  expect(result.props.children.props.ticketData.selectedConversationId).toBe('delivery');
  expect(result.props.children.key).toBe('ticket:delivery');
});
it.each([{ conversation: 'private', conversationStore: 'foreign' }, { conversation: ['one', 'two'] }, { conversationStore: 'owner' }])('does not render ticket content for inconsistent route scope %j', async query => {
  const result = await page(query);
  expect(result.props.id).toBe('ticket-error-message');
  expect(mocks.statuses).not.toHaveBeenCalled();
});
it('keeps the action denial opaque and preserves normal default entry', async () => {
  mocks.read.mockResolvedValueOnce({ permissionError: 'This conversation is unavailable.' });
  expect((await page({ conversation: 'private', conversationStore: 'owner' })).props.id).toBe('ticket-error-message');
  const result = await page({ tenant: 'portal-slug' });
  expect(result.props.children.props.ticketData.selectedConversationId).toBe('default');
});
