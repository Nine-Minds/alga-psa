// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CoManagedClientSummary from '@/components/co-managed/CoManagedClientSummary';
import { HEADER_CASES } from './fixtures';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));

afterEach(cleanup);

const mount = (v: any, onOpenTab = vi.fn(), onSelectRelationship = vi.fn()) => {
  render(<CoManagedClientSummary view={v} clientId="client-1" idPrefix="t" onOpenTab={onOpenTab} onSelectRelationship={onSelectRelationship} />);
  return { onOpenTab, onSelectRelationship };
};

describe('client header summary', () => {
  it('no relationship, authorized: text plus the one Enable action that opens the tab', () => {
    const { onOpenTab } = mount(HEADER_CASES.noRelationshipAuthorized);
    expect(screen.getByText('Co-managed IT not enabled')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onOpenTab).toHaveBeenCalledWith('co-managed');
  });

  it('no relationship, unauthorized: text only, no action of any kind', () => {
    mount(HEADER_CASES.noRelationshipUnauthorized);
    expect(screen.getByText('Co-managed IT not enabled')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('active: state, seat usage, exactly one action', () => {
    mount(HEADER_CASES.active);
    expect(screen.getByText('2 of 5 technician seats')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('ended: shows the end date and a history action, never "not enabled"', () => {
    const { onSelectRelationship, onOpenTab } = mount(HEADER_CASES.ended);
    expect(screen.getByText('Ended 2026-10-01')).toBeInTheDocument();
    expect(screen.queryByText('Co-managed IT not enabled')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View history' }));
    expect(onSelectRelationship).toHaveBeenCalledWith('rel-1');
    expect(onOpenTab).toHaveBeenCalledWith('co-managed');
  });

  it('one live + one ended: the live one wins and the header has no chooser', () => {
    mount(HEADER_CASES.oneLiveOneEnded);
    expect(screen.getByText('2 of 5 technician seats')).toBeInTheDocument();
    expect(screen.queryByText('Choose relationship')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('several live: "Multiple…" and a chooser, no implicit pick', () => {
    const { onSelectRelationship } = mount(HEADER_CASES.severalLive);
    expect(screen.getByText('Multiple co-managed relationships')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose relationship' }));
    expect(onSelectRelationship).not.toHaveBeenCalled();
  });

  it('cancelled-only: treated as never set up, Enable offered', () => {
    mount(HEADER_CASES.cancelledOnly);
    expect(screen.getByText('Co-managed IT not enabled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable co-managed IT' })).toBeInTheDocument();
  });
});
