// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CoManagedWorkspaceNotice from '@/components/co-managed/CoManagedWorkspaceNotice';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));

afterEach(cleanup);

describe('CoManagedWorkspaceNotice', () => {
  it('renders the ended notice naming the provider', () => {
    render(<CoManagedWorkspaceNotice notice={{ kind: 'ended', endedAt: '2026-10-01T00:00:00.000Z', sponsorName: 'Northwind MSP' }} />);
    expect(screen.getByText(/Co-managed IT ended 2026-10-01/)).toBeInTheDocument();
    expect(screen.getByText(/Northwind MSP no longer has access/)).toBeInTheDocument();
  });

  it('renders nothing without a notice (psa and algadesk are never given one)', () => {
    const { container } = render(<CoManagedWorkspaceNotice notice={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
