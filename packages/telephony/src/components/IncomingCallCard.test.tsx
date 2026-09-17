// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingCallPayload } from '../types/incomingCall';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; [key: string]: unknown }) => {
      const template = options?.defaultValue ?? _key;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
    },
  }),
  useFormatters: () => ({
    formatDate: (date: string | Date) => new Date(date).toISOString().slice(0, 10),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { IncomingCallCard } from './IncomingCallCard';

const matched: IncomingCallPayload = {
  callId: 'call-1',
  participantId: 'p-1',
  dn: '101',
  number: '+1 555-123-4567',
  numberE164: '+15551234567',
  callerName: 'Ada Lovelace',
  matchStatus: 'matched',
  contact: { id: 'c-1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '+15551234567' },
  client: { id: 'cl-1', name: 'Analytical Engines' },
  tickets: [
    { id: 't-1', number: '1001', title: 'Printer offline', status: 'Open' },
    { id: 't-2', number: '1002', title: 'VPN drops', status: 'In progress' },
  ],
  interactions: [{ id: 'i-1', type: 'Call', title: 'Follow-up', date: '2026-09-14T09:00:00.000Z' }],
  at: '2026-09-15T10:00:00.000Z',
};

const unknown: IncomingCallPayload = {
  callId: 'call-2',
  participantId: 'p-2',
  dn: '101',
  number: '+1 555-987-6543',
  numberE164: '+15559876543',
  callerName: null,
  matchStatus: 'unmatched',
  contact: null,
  client: null,
  tickets: [],
  interactions: [],
};

function renderCard(call: IncomingCallPayload, overrides: Partial<React.ComponentProps<typeof IncomingCallCard>> = {}) {
  const props = {
    onDismiss: vi.fn(),
    onNewTicket: vi.fn(),
    onCreateContact: vi.fn(),
    ...overrides,
  };
  const utils = render(<IncomingCallCard call={call} {...props} />);
  return { ...utils, ...props };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('IncomingCallCard', () => {
  it('T057: renders name, number, client, extension, email, ticket links and interactions for a matched call', () => {
    renderCard(matched);

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('+1 555-123-4567')).toBeTruthy();
    expect(screen.getByText('Analytical Engines')).toBeTruthy();
    expect(screen.getByText('Ringing extension 101')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();

    const ticketLink = document.getElementById('incoming-call-ticket-t-1') as HTMLAnchorElement;
    expect(ticketLink.getAttribute('href')).toBe('/msp/tickets/t-1');
    expect(ticketLink.textContent).toContain('#1001 Printer offline');
    expect(screen.getByText('(Open)')).toBeTruthy();

    const interaction = document.getElementById('incoming-call-interaction-i-1');
    expect(interaction?.textContent).toContain('Call: Follow-up');
    expect(interaction?.textContent).toContain('2026-09-14');

    expect(document.getElementById('incoming-call-open-contact')?.getAttribute('href')).toBe('/msp/contacts/c-1');
    expect(document.getElementById('incoming-call-open-client')?.getAttribute('href')).toBe('/msp/clients/cl-1');
    expect(document.getElementById('incoming-call-new-ticket')).toBeTruthy();
    expect(document.getElementById('incoming-call-create-contact')).toBeNull();
  });

  it('T058: renders Unknown caller and Create contact for an unmatched call', () => {
    const { onCreateContact } = renderCard(unknown);

    expect(screen.getByText('Unknown caller')).toBeTruthy();
    expect(screen.getByText('+1 555-987-6543')).toBeTruthy();
    expect(document.getElementById('incoming-call-open-contact')).toBeNull();
    expect(document.getElementById('incoming-call-new-ticket')).toBeNull();
    expect(document.getElementById('incoming-call-tickets')).toBeNull();

    fireEvent.click(document.getElementById('incoming-call-create-contact')!);
    expect(onCreateContact).toHaveBeenCalledWith(unknown);
  });

  it('T229: Answer shows only when the PBX grants direct control and an answer handler exists', () => {
    const onAnswer = vi.fn();
    const { unmount } = renderCard({ ...matched, directControl: true }, { onAnswer });
    fireEvent.click(document.getElementById('incoming-call-answer')!);
    expect(onAnswer).toHaveBeenCalledWith({ ...matched, directControl: true });
    unmount();

    renderCard({ ...matched, directControl: false }, { onAnswer: vi.fn() });
    expect(document.getElementById('incoming-call-answer')).toBeNull();
    cleanup();

    renderCard({ ...matched, directControl: true });
    expect(document.getElementById('incoming-call-answer')).toBeNull();
  });

  it('T059: New ticket hands the matched call to the host', () => {
    const { onNewTicket } = renderCard(matched);
    fireEvent.click(document.getElementById('incoming-call-new-ticket')!);
    expect(onNewTicket).toHaveBeenCalledWith(matched);
  });

  it('Dismiss closes the card from both the header and the action row', () => {
    const { onDismiss } = renderCard(matched);
    fireEvent.click(document.getElementById('incoming-call-dismiss')!);
    fireEvent.click(document.getElementById('incoming-call-dismiss-action')!);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  describe('auto close', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('T061: closes after 60 seconds', () => {
      const { onDismiss } = renderCard(matched);
      act(() => {
        vi.advanceTimersByTime(59_999);
      });
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('T062: a newer call restarts the countdown', () => {
      const onDismiss = vi.fn();
      const { rerender } = render(
        <IncomingCallCard call={matched} onDismiss={onDismiss} onNewTicket={vi.fn()} onCreateContact={vi.fn()} />,
      );
      act(() => {
        vi.advanceTimersByTime(40_000);
      });
      rerender(
        <IncomingCallCard call={unknown} onDismiss={onDismiss} onNewTicket={vi.fn()} onCreateContact={vi.fn()} />,
      );
      expect(screen.getByText('Unknown caller')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  it('T063: is a fixed, non-modal bottom-right surface whose buttons all carry kebab-case ids', () => {
    renderCard(matched);
    const card = document.getElementById('incoming-call-card')!;
    expect(card.className).toContain('fixed');
    expect(card.className).toContain('bottom-4');
    expect(card.className).toContain('right-4');
    expect(card.getAttribute('role')).toBe('status');
    expect(card.getAttribute('aria-modal')).toBeNull();

    const buttons = Array.from(card.querySelectorAll('button, a'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const element of buttons) {
      expect(element.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
