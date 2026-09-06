/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoManagedWorkspaceBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), review: vi.fn(), accept: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({
  getCustomerCoManagedAcceptance: mocks.review, acceptCustomerCoManagedRelationship: mocks.accept,
}));
const translate = (key: string) => key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }), useOptionalI18n: () => null }));
const review = { state: 'pending_acceptance', relationshipId: 'relationship', revision: 1, scopeFingerprint: 'hash', canAccept: true,
  scope: { sponsorName: 'MSP', visibilityMode: 'board_scope', escalationBoard: { id: 'destination', name: 'Escalations' },
    boards: [{ id: 'customer-board', name: 'Customer service desk', canCollaborate: true }], projects: [], delegatedAdministration: [] } };
const workspace = () => render(<CoManagedWorkspaceBoundary productCode="co_managed" requireAcceptance><p>Workspace content</p></CoManagedWorkspaceBoundary>);
beforeEach(() => { vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.review.mockResolvedValue(review); });
afterEach(cleanup);
describe('initial customer scope review', () => {
  it('does not fetch or expose acceptance when the UI release flag is disabled', () => {
    mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null }); workspace();
    expect(mocks.review).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
  });
  it('waits for deliberate approval of the shown scope before displaying the workspace', async () => {
    workspace();
    const button = await screen.findByRole('button', { name: 'coManaged.acceptance.accept' });
    expect(screen.getByText(/Customer service desk/)).toBeTruthy();
    expect(screen.queryByText('Workspace content')).toBeNull(); expect(mocks.accept).not.toHaveBeenCalled();
    mocks.review.mockResolvedValue({ state: 'active' }); fireEvent.click(button);
    await screen.findByText('Workspace content');
    expect(mocks.accept).toHaveBeenCalledWith({ relationshipId: 'relationship', revision: 1, scopeFingerprint: 'hash' });
  });
  it('requires a fresh review after a failed approval and never retries changed terms automatically', async () => {
    mocks.accept.mockRejectedValue(new Error('Scope changed')); workspace();
    fireEvent.click(await screen.findByRole('button', { name: 'coManaged.acceptance.accept' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'coManaged.acceptance.accept' })).toBeDisabled();
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    mocks.review.mockResolvedValue({ ...review, revision: 2, scopeFingerprint: 'new-hash' });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.acceptance.refresh' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.accept).toHaveBeenCalledTimes(1);
  });
  it('shows a waiting message to a customer technician without acceptance permission', async () => {
    mocks.review.mockResolvedValue({ ...review, canAccept: false }); workspace();
    await screen.findByText('coManaged.acceptance.administratorRequired');
    expect(screen.queryByRole('button', { name: 'coManaged.acceptance.accept' })).toBeNull();
  });
  it('does not ask a requester portal to perform administrator acceptance', () => {
    render(<CoManagedWorkspaceBoundary productCode="co_managed"><p>Requester portal</p></CoManagedWorkspaceBoundary>);
    expect(screen.getByText('Requester portal')).toBeTruthy(); expect(mocks.review).not.toHaveBeenCalled();
  });
});
