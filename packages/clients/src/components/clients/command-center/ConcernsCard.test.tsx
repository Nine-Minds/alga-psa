/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClientAttentionFlag } from '../../../lib/commandCenterTypes';
import ConcernsCard from './ConcernsCard';

vi.mock('@alga-psa/ui/components/bento', () => ({
  BentoTile: ({ id, title, action, children }: {
    id: string;
    title?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <section id={id}>
      {title ? <h3>{title}</h3> : null}
      {action}
      {children}
    </section>
  ),
}));

const t = (key: string, options?: Record<string, unknown>) => {
  const value = options?.defaultValue ?? options?.defaultValue_other ?? key;
  return String(value).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
};

const flag = (overrides: Partial<ClientAttentionFlag>): ClientAttentionFlag => ({
  kind: 'ticket_overdue',
  severity: 'amber',
  count: 2,
  ...overrides,
} as ClientAttentionFlag);

const renderCard = (flags: ClientAttentionFlag[], onFlagClick = vi.fn()) => {
  const result = render(
    <ConcernsCard id="cc" flags={flags} formatMoney={(cents) => `$${cents / 100}`} onFlagClick={onFlagClick} t={t} />,
  );
  return { ...result, onFlagClick };
};

describe('ConcernsCard', () => {
  it('renders nothing when there are no flags', () => {
    const { container } = renderCard([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per flag with a count chip', () => {
    renderCard([
      flag({ kind: 'ticket_overdue', refLabel: '#42', daysAgo: 3 }),
      flag({ kind: 'sla_breached', severity: 'amber', count: 1, refLabel: '#7' }),
    ]);

    expect(screen.getByText(/overdue tickets/)).toBeInTheDocument();
    expect(screen.getByText(/SLA breaches/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders the flag label without emoji glyphs', () => {
    renderCard([flag({ kind: 'client_waiting', severity: 'blue', count: 1, refLabel: '#9', daysAgo: 4 })]);

    const label = screen.getByText(/Client waiting/);
    expect(label.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('calls onFlagClick with the clicked flag', () => {
    const overdue = flag({ kind: 'ticket_overdue', refLabel: '#42' });
    const rma = flag({ kind: 'rma_open', severity: 'gray', count: 1 });
    const { onFlagClick } = renderCard([overdue, rma]);

    fireEvent.click(screen.getByText(/open RMAs/).closest('button')!);

    expect(onFlagClick).toHaveBeenCalledTimes(1);
    expect(onFlagClick).toHaveBeenCalledWith(rma);
  });

  it('gives every flag button a stable id', () => {
    renderCard([flag({ kind: 'wip_aging', severity: 'gray', count: 3, daysAgo: 12 })]);

    expect(document.getElementById('cc-flag-wip_aging-0')).not.toBeNull();
  });
});
