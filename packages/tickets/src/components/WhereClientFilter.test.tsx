/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, d: any) => (typeof d === 'string' ? d : d?.defaultValue ?? _k) }),
}));
vi.mock('@alga-psa/ui/components/AsyncClientPicker', () => ({
  AsyncClientPicker: (props: any) => (
    <button type="button" data-testid="picker" onClick={() => props.onSelectedClientIdsChange([...props.selectedClientIds, 'new'])}>
      {props.selectedClientIds.length}:{props.placeholder}
    </button>
  ),
}));

import { WhereClientFilter } from './WhereClientFilter';

const search = vi.fn();

describe('WhereClientFilter', () => {
  it('has no mode button until something is selected', () => {
    render(<WhereClientFilter id="f" searchClients={search} selection={null} onChange={() => {}} />);
    expect(screen.queryByText('Any of')).toBeNull();
    expect(screen.getByTestId('picker').textContent).toBe('0:All Clients');
  });

  it('picking clients starts in Any of mode', () => {
    const onChange = vi.fn();
    render(<WhereClientFilter id="f" searchClients={search} selection={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('picker'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'in', ids: ['new'] });
  });

  it('the mode button flips to None of and keeps the clients; picking keeps the mode', () => {
    const onChange = vi.fn();
    render(<WhereClientFilter id="f" searchClients={search} selection={{ mode: 'in', ids: ['a', 'b'] }} onChange={onChange} />);
    fireEvent.click(screen.getByText('Any of'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'not_in', ids: ['a', 'b'] });
  });

  it('keeps None of when another client is picked', () => {
    const onChange = vi.fn();
    render(<WhereClientFilter id="f" searchClients={search} selection={{ mode: 'not_in', ids: ['a'] }} onChange={onChange} />);
    expect(screen.getByText('None of')).toBeTruthy();
    fireEvent.click(screen.getByTestId('picker'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'not_in', ids: ['a', 'new'] });
  });
});
