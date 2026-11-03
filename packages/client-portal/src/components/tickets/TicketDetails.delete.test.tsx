/* @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IComment } from '@alga-psa/types';
import type { ClientTicketDetailResponse } from '../../actions/client-portal-actions/clientTicketProjection';

const mocks = vi.hoisted(() => ({
  deleteComment: vi.fn(),
  getDetails: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientTicketDetails: mocks.getDetails,
  getClientTicketDocuments: vi.fn().mockResolvedValue([]),
  getClientDocumentFolders: vi.fn(),
  addClientTicketComment: vi.fn(),
  updateClientTicketComment: vi.fn(),
  deleteClientTicketComment: mocks.deleteComment,
  updateTicketStatus: vi.fn(),
  getAppointmentRequestsByTicketId: vi.fn().mockResolvedValue({ success: true, data: [] }),
  getClientAssetById: vi.fn(),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@alga-psa/teams/actions', () => ({ getTeamAvatarUrlsBatchAction: vi.fn() }));
vi.mock('@alga-psa/tickets/actions/ticketDisplaySettings', () => ({ getTicketingDisplaySettings: vi.fn().mockResolvedValue({}) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key, i18n: { language: 'en' } }) }));
vi.mock('@alga-psa/ui', () => ({ getDateFnsLocale: () => undefined }));
vi.mock('@alga-psa/ui/components/EmailHtmlViewer', () => ({ useInboundEmailView: () => ({ switcher: null, body: (value: React.ReactNode) => value }) }));
vi.mock('@alga-psa/tickets/hooks/useInboundEmailViewPreference', () => ({ useInboundEmailViewPreference: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/inboundEmailOriginalView', () => ({ originalEmailToggleLabels: () => ({}) }));
vi.mock('@alga-psa/tickets/components', () => ({
  TicketConversation: ({ conversations, onDelete }: { conversations: IComment[]; onDelete: (comment: IComment) => void }) => <div>
    <span data-testid="conversation-count">{conversations.length}</span>
    <button onClick={() => onDelete(conversations[0])}>Trigger delete</button>
  </div>,
  TicketDocumentsSection: () => null,
  TicketAppointmentRequests: () => null,
  TicketOriginBadge: () => null,
}));
vi.mock('./PortalTicketExternalLinks', () => ({ PortalTicketExternalLinks: () => null }));
vi.mock('../assets/AssetDetails', () => ({ AssetDetails: () => null }));
vi.mock('@alga-psa/ui/editor', () => ({ RichTextViewer: () => null }));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@alga-psa/ui/components', () => ({ ResponseStateBadge: () => null }));
vi.mock('@alga-psa/ui/components/UserAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ getErrorMessage: () => 'error', handleError: vi.fn(), isActionMessageError: () => false, isActionPermissionError: () => false }));

import { TicketDetails } from './TicketDetails';

const own = {
  comment_id: 'own-comment', note: 'own', is_system_generated: false,
  portal_can_edit: true, portal_author: { name: 'Dorothy', role: 'client' },
} as unknown as IComment;

function ticket(comment: IComment, canInteract = true): ClientTicketDetailResponse {
  return {
    ticket_id: 'ticket-1', ticket_number: '1', entered_at: new Date().toISOString(),
    title: 'Ticket', status_id: 'status-1', conversations: [comment], documents: [],
    can_interact: canInteract,
  } as unknown as ClientTicketDetailResponse;
}

function renderDetails(comment: IComment, canInteract = true) {
  return render(<TicketDetails ticketId="ticket-1" isOpen asStandalone onClose={() => {}}
    initialTicket={ticket(comment, canInteract)} initialDocuments={[]} initialStatusOptions={[]} />);
}

describe('TicketDetails projected comment deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ user_id: 'portal-user', first_name: 'Dorothy', last_name: 'User' });
    mocks.deleteComment.mockResolvedValue(undefined);
    mocks.getDetails.mockImplementation(async () => ticket(own));
  });

  it('deletes an own projected comment without user_id and refreshes the conversation', async () => {
    mocks.getDetails.mockResolvedValue({ ...ticket(own), conversations: [] });
    renderDetails(own);
    await screen.findByText('1');
    fireEvent.click(screen.getByRole('button', { name: 'Trigger delete' }));
    await waitFor(() => expect(mocks.deleteComment).toHaveBeenCalledWith('own-comment'));
    await waitFor(() => expect(screen.getByTestId('conversation-count')).toHaveTextContent('0'));
    expect(mocks.getDetails).toHaveBeenCalledWith('ticket-1');
  });

  it.each([
    ['non-owner capability', { ...own, portal_can_edit: false }, true],
    ['collaborator attribution despite capability', { ...own, portal_author: { name: 'Partner', role: 'collaborator' } }, true],
    ['read-only ticket', own, false],
  ])('denies deletion for %s', async (_case, comment, canInteract) => {
    renderDetails(comment as IComment, canInteract as boolean);
    await screen.findByRole('button', { name: 'Trigger delete' });
    fireEvent.click(screen.getByRole('button', { name: 'Trigger delete' }));
    await waitFor(() => expect(mocks.deleteComment).not.toHaveBeenCalled());
  });
});
