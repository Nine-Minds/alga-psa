/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_k: string, d: any) =>
      typeof d === 'string'
        ? d
        : String(d?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(d?.[name] ?? '')),
  }),
}));
vi.mock('@alga-psa/ui/components/AsyncClientPicker', () => ({
  // Stands in for the picker: the trigger, plus the footer it renders inside its popover.
  AsyncClientPicker: (props: any) => (
    <>
      <button type="button" data-testid="picker" onClick={() => props.onSelectedClientIdsChange([...props.selectedClientIds, 'new'])}>
        {props.selectedClientIds.length}:{props.formatSelectedLabel?.('2 clients') ?? props.placeholder}
      </button>
      <div data-testid="picker-footer">{props.footerContent}</div>
    </>
  ),
}));

import { WhereClientFilter } from './WhereClientFilter';

const search = vi.fn();

describe('WhereClientFilter', () => {
  it('is one plain picker until something is selected: no match switch anywhere', () => {
    render(<WhereClientFilter id="f" searchClients={search} selection={null} onChange={() => {}} />);
    expect(screen.queryByText('Any of')).toBeNull();
    expect(screen.getByTestId('picker-footer').textContent).toBe('');
  });

  it('puts the match switch in the picker footer, not beside the picker', () => {
    render(<WhereClientFilter id="f" searchClients={search} selection={{ mode: 'in', ids: ['a'] }} onChange={() => {}} />);
    const footer = screen.getByTestId('picker-footer');
    expect(footer.textContent).toContain('Any of');
    expect(footer.textContent).toContain('None of');
  });

  it('marks an exclusion on the trigger', () => {
    const { rerender } = render(
      <WhereClientFilter id="f" searchClients={search} selection={{ mode: 'in', ids: ['a', 'b'] }} onChange={() => {}} />,
    );
    expect(screen.getByTestId('picker').textContent).toBe('2:2 clients');
    rerender(<WhereClientFilter id="f" searchClients={search} selection={{ mode: 'not_in', ids: ['a', 'b'] }} onChange={() => {}} />);
    expect(screen.getByTestId('picker').textContent).toBe('2:Excluding 2 clients');
  });

  it('picking clients starts in Any of mode', () => {
    const onChange = vi.fn();
    render(<WhereClientFilter id="f" searchClients={search} selection={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('picker'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'in', ids: ['new'] });
  });

  it('switching to None of keeps the clients', () => {
    const onChange = vi.fn();
    render(<WhereClientFilter id="f" searchClients={search} selection={{ mode: 'in', ids: ['a', 'b'] }} onChange={onChange} />);
    fireEvent.click(screen.getByText('None of'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'not_in', ids: ['a', 'b'] });
  });

  it('keeps None of when another client is picked', () => {
    const onChange = vi.fn();
    render(<WhereClientFilter id="f" searchClients={search} selection={{ mode: 'not_in', ids: ['a'] }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'None of' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('picker'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'not_in', ids: ['a', 'new'] });
  });
});
