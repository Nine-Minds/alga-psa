/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ screen: vi.fn(), assignment: vi.fn() }));
vi.mock('lucide-react', () => ({ Handshake: () => null, History: () => null }));
vi.mock('@alga-psa/ui/components/bento/BentoTile', () => ({ BentoTile: ({ id, children, action }: any) => <section id={id}>{action}{children}</section> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant: _v, size: _s, ...rest }: any) => <button {...rest}>{children}</button> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: () => null, DialogContent: () => null }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string, o?: any) => typeof o === 'string' ? o : o?.defaultValue ?? k }) }));
vi.mock('@/lib/actions/coManagedSharedWorkActions', () => ({ getCoManagedTicketScreenAction: (...a: any[]) => mocks.screen(...a) }));
vi.mock('@/lib/actions/coManagedTicketAssignmentActions', () => ({
  getSharedTicketAssignmentAction: (...a: any[]) => mocks.assignment(...a), listSharedTicketAssigneesAction: vi.fn(), assignSharedTicketAction: vi.fn(),
}));
vi.mock('@/components/co-managed/CoManagedHandoffDialog', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedHandoffHistoryDrawer', () => ({ default: () => null }));

import CoManagedTicketSection from '@/components/co-managed/CoManagedTicketSection';

const resource = { tenant: 'customer', relationshipId: 'rel', kind: 'ticket' as const, id: 'ticket' };
const screenFor = (over: Record<string, unknown> = {}) => ({
  side: 'sponsor', canWrite: true, canUpdate: true, canEscalate: true, canHandBack: true, canRevoke: true,
  customerName: 'Customer Co', sponsorName: 'MSP Co',
  summary: { resource, revision: 1, fields: { responsibility: 'msp', work_revision: 4 } }, ...over,
});

beforeEach(() => {
  mocks.screen.mockReset(); mocks.assignment.mockReset();
  mocks.assignment.mockResolvedValue({ resource, canEdit: false, canAssign: false, revision: 4, hasAssignment: true, mspAssignment: { name: 'Pat Person', organizationName: 'MSP Co' } });
});

describe('CoManagedTicketSection capability-driven affordances', () => {
  it('a writer sees the handoff actions and no read-only notice', async () => {
    mocks.screen.mockResolvedValue(screenFor());
    render(<CoManagedTicketSection target={{ kind: 'shared', resource }} />);
    expect(await screen.findByText('MSP Co')).toBeInTheDocument();
    expect(document.getElementById('co-ticket-escalate')).not.toBeNull();
    expect(document.getElementById('co-ticket-handback')).not.toBeNull();
    expect(document.getElementById('co-ticket-revoke')).not.toBeNull();
    expect(document.getElementById('co-ticket-read-only')).toBeNull();
  });

  it('a read-only viewer sees a notice and no write controls', async () => {
    mocks.screen.mockResolvedValue(screenFor({ canWrite: false, canEscalate: false, canHandBack: false, canRevoke: false }));
    render(<CoManagedTicketSection target={{ kind: 'shared', resource }} />);
    await screen.findByText('MSP Co');
    expect(document.getElementById('co-ticket-read-only')).not.toBeNull();
    for (const id of ['co-ticket-escalate', 'co-ticket-handback', 'co-ticket-revoke', 'co-ticket-handoff-actions', 'co-ticket-assignment-change']) {
      expect(document.getElementById(id)).toBeNull();
    }
  });

  it('even if the flags say yes, a non-writer gets none of the actions (canAct requires canWrite)', async () => {
    mocks.screen.mockResolvedValue(screenFor({ canWrite: false }));
    render(<CoManagedTicketSection target={{ kind: 'shared', resource }} />);
    await screen.findByText('MSP Co');
    expect(document.getElementById('co-ticket-handoff-actions')).toBeNull();
  });

  it('a section for a native ticket is only mounted by the provider; its tile id follows the layout', async () => {
    mocks.screen.mockResolvedValue(screenFor());
    render(<CoManagedTicketSection target={{ kind: 'shared', resource }} layout="grid" />);
    await screen.findByText('MSP Co');
    expect(document.getElementById('co-managed-section-grid')).not.toBeNull();
  });

  it('shows a reload alert when the screen read fails', async () => {
    mocks.screen.mockRejectedValue(new Error('denied'));
    render(<CoManagedTicketSection target={{ kind: 'shared', resource }} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(document.getElementById('co-ticket-reload')).not.toBeNull();
  });

  it('the assignment value wraps instead of truncating', async () => {
    mocks.screen.mockResolvedValue(screenFor());
    mocks.assignment.mockResolvedValue({ resource, canEdit: false, canAssign: false, revision: 4, hasAssignment: true,
      mspAssignment: { name: 'A Very Long Technician Name', organizationName: 'An Extremely Long Managed Service Provider Organization' } });
    render(<CoManagedTicketSection target={{ kind: 'shared', resource }} />);
    const value = await screen.findByText(/An Extremely Long Managed Service Provider Organization/);
    expect(value.id).toBe('co-ticket-assignment-value');
    expect(value).toHaveClass('break-words', 'flex-1', 'text-right');
    expect(value).not.toHaveClass('truncate');
  });
});
