/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import Adapter from '../../../components/co-managed/CoManagedTicketQueueLegacyAdapter';

afterEach(() => { cleanup(); nav.replace.mockReset(); });

describe('T025 — /msp/co-managed/tickets retarget', () => {
  it('sends bookmarks to Customer Tickets, never back to the native list', () => {
    nav.search = 'queueView=oversight&workspace=&signal=awaiting_reply';
    render(<Adapter />);
    const target = nav.replace.mock.calls[0][0] as string;
    expect(target.startsWith('/msp/tickets/customer')).toBe(true);
    expect(target).toContain('signal=awaiting_reply');
  });

  it('defaults a bare bookmark to the working view over all workspaces', () => {
    nav.search = '';
    render(<Adapter />);
    expect(nav.replace.mock.calls[0][0]).toMatch(/^\/msp\/tickets\/customer/);
  });
});
