// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let text = (opts?.defaultValue as string) ?? key;
      for (const [k, v] of Object.entries(opts ?? {})) text = text.replace(`{{${k}}}`, String(v));
      return text;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, disabled, id }: any) =>
    React.createElement('button', { type: 'button', onClick, disabled, id }, children),
}));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: any) => React.createElement('div', { id }, children),
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, id }: any) => React.createElement('span', { id }, children),
}));

const { SuggestedEntriesSection } = await import(
  '../src/components/time-management/time-entry/time-sheet/SuggestedEntriesSection'
);

const suggestion = {
  ticket_id: 'tkt-1',
  ticket_number: 'TIC1001',
  title: 'Printer down',
  client_name: 'Acme',
  work_date: '2026-04-12',
  time_zone: 'UTC',
  first_touch: '2026-04-12T09:02:00.000Z',
  last_touch: '2026-04-12T10:10:00.000Z',
  event_count: 3,
  event_kinds: ['ticket.comment_added'],
};

describe('SuggestedEntriesSection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
  });

  function render(props: Record<string, unknown>) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        React.createElement(SuggestedEntriesSection, {
          suggestions: [],
          onLogTime: vi.fn(),
          onDismiss: vi.fn(),
          onDismissDay: vi.fn(),
          ...props,
        } as any),
      );
    });
    return container;
  }

  it('shows the empty state', () => {
    const c = render({});
    expect(c.textContent).toContain('No suggestions for this period');
    expect(c.querySelector('#time-sheet-suggestions-count')).toBeNull();
  });

  it('renders display names, a count badge, and wires the row actions', () => {
    const onLogTime = vi.fn();
    const onDismiss = vi.fn();
    const onDismissDay = vi.fn();
    const c = render({ suggestions: [suggestion], onLogTime, onDismiss, onDismissDay });

    expect(c.textContent).toContain('TIC1001 Printer down');
    expect(c.textContent).toContain('Acme');
    expect(c.querySelector('#time-sheet-suggestions-count')?.textContent).toBe('1');
    expect(c.textContent).not.toContain('tkt-1');

    (c.querySelector('#time-sheet-suggestion-tkt-1-2026-04-12-log') as HTMLButtonElement).click();
    expect(onLogTime).toHaveBeenCalledWith(suggestion);
    (c.querySelector('#time-sheet-suggestion-tkt-1-2026-04-12-dismiss') as HTMLButtonElement).click();
    expect(onDismiss).toHaveBeenCalledWith(suggestion);
    (c.querySelector('#time-sheet-suggestions-dismiss-day-2026-04-12') as HTMLButtonElement).click();
    expect(onDismissDay).toHaveBeenCalledWith('2026-04-12');
  });

  it('disables actions while busy', () => {
    const c = render({ suggestions: [suggestion], isBusy: true });
    expect((c.querySelector('#time-sheet-suggestion-tkt-1-2026-04-12-log') as HTMLButtonElement).disabled).toBe(true);
  });
});
