/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signals: vi.fn(), capability: { enabled: true, admitted: true, resolved: true } }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: () => mocks.capability }));
vi.mock('@/context/ProductContext', () => ({ useProduct: () => ({ productCode: 'psa' }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => typeof o === 'string' ? o : (o?.defaultValue ?? k).replace('{{count}}', String(o?.count ?? '')) }),
}));
vi.mock('@/lib/actions/coManagedTicketQueueActions', () => ({ getCoManagedWorkSignalsAction: (...a: any[]) => mocks.signals(...a) }));
vi.mock('@/components/co-managed/CoManagedAcceptanceBoundary', () => ({ default: () => null }));

import { CoManagedCalloutStrip, calloutHref } from '@/components/co-managed/CoManagedCalloutStrip';

beforeEach(() => { mocks.signals.mockReset(); mocks.capability = { enabled: true, admitted: true, resolved: true }; });

describe('CoManagedCalloutStrip', () => {
  it('shows the callout with deep links into Customer Tickets when there is shared work', async () => {
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 1, signals: { escalatedUnassigned: 2, awaitingReply: 4 } });
    render(<CoManagedCalloutStrip />);
    expect(await screen.findByTestId('co-managed-callout')).toBeInTheDocument();
    const href = screen.getByText('2 escalated, unassigned').getAttribute('href')!;
    expect(href).toBe(calloutHref('escalated_unassigned'));
    expect(href.startsWith('/msp/tickets/customer')).toBe(true);
    expect(new URL(href, 'http://x').searchParams.get('signal')).toBe('escalated_unassigned');
    expect(new URL(calloutHref('awaiting_reply'), 'http://x').searchParams.get('signal')).toBe('awaiting_reply');
  });

  it('is hidden (no shared work) when the counts are zero', async () => {
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 1, signals: { escalatedUnassigned: 0, awaitingReply: 0 } });
    render(<CoManagedCalloutStrip />);
    await waitFor(() => expect(mocks.signals).toHaveBeenCalled());
    expect(screen.queryByTestId('co-managed-callout')).not.toBeInTheDocument();
  });

  it('renders nothing and reads nothing when the capability is closed (native /msp/tickets)', async () => {
    mocks.capability = { enabled: false, admitted: false, resolved: true };
    const { container } = render(<CoManagedCalloutStrip />);
    await Promise.resolve();
    expect(mocks.signals).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
