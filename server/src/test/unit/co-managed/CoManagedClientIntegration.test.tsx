// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { view } from './fixtures';

const capability = vi.hoisted(() => ({ admitted: true }));
const getView = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/ui/hooks', () => ({
  useCapability: () => ({ enabled: capability.admitted, admitted: capability.admitted, resolved: true }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));
vi.mock('@/lib/actions/coManagedActions', () => ({ getCoManagedClientManagement: getView }));
vi.mock('@/components/co-managed/CoManagedClientView', () => ({ default: () => <div>tab-body</div> }));
vi.mock('@/components/co-managed/CoManagedClientSummary', () => ({ default: () => <div>summary</div> }));

import Integration from '@/components/co-managed/CoManagedClientIntegration';

const mount = (children: (slots: any) => React.ReactNode) =>
  render(<Integration clientId="client-1" clientName="Acme" idPrefix="t" children={children} />);

beforeEach(() => { capability.admitted = true; getView.mockReset(); });
afterEach(cleanup);

describe('client co-managed integration slots', () => {
  it('capability off: children(null) and no action call', async () => {
    capability.admitted = false;
    const children = vi.fn(() => <div>ordinary</div>);
    mount(children);
    expect(screen.getByText('ordinary')).toBeInTheDocument();
    expect(children).toHaveBeenLastCalledWith(null);
    expect(getView).not.toHaveBeenCalled();
  });

  it('read denied: no summary, no tab', async () => {
    getView.mockRejectedValue(new Error('denied'));
    const seen: any[] = [];
    mount((slots) => { seen.push(slots); return <div>ordinary</div>; });
    await waitFor(() => expect(getView).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(seen.every((slots) => slots === null)).toBe(true);
    expect(screen.queryByText('summary')).not.toBeInTheDocument();
  });

  it('ready: a summary and exactly one co-managed tab', async () => {
    getView.mockResolvedValue(view());
    let latest: any = null;
    mount((slots) => { latest = slots; return <div>{slots?.summary}</div>; });
    await waitFor(() => expect(screen.getByText('summary')).toBeInTheDocument());
    expect(latest.tab.id).toBe('co-managed');
    expect(latest.tab.hasUnsavedChanges()).toBe(false);
    expect(getView).toHaveBeenCalledTimes(1);
  });
});
