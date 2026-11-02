/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContactPicker } from './ContactPicker';
import { ClientPicker } from './ClientPicker';

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: (info: any) => ({ automationIdProps: { id: info.id }, updateMetadata: vi.fn() }),
}));
vi.mock('./ClientAvatar', () => ({ default: ({ clientName }: any) => <span>{clientName[0]}</span> }));
vi.mock('./ContactAvatar', () => ({ default: ({ contactName }: any) => <span>{contactName[0]}</span> }));
vi.mock('./CustomSelect', () => ({ default: () => null }));
vi.mock('./tags/TagFilter', () => ({ TagFilter: () => null }));

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const vip = { tag_id: 'vip', tag_text: 'VIP', background_color: null, text_color: null };

describe('picker option tags', () => {
  it('ContactPicker shows display tags on the selected value and on options', () => {
    const contacts = [
      { contact_name_id: 'c1', full_name: 'Kay One', email: 'k@x.io', is_inactive: false, displayTags: [vip] },
      { contact_name_id: 'c2', full_name: 'Lee Two', email: 'l@x.io', is_inactive: false, displayTags: [] },
    ] as any[];
    render(<ContactPicker id="cp" contacts={contacts} value="c1" onValueChange={() => {}} />);
    expect(screen.getAllByTestId('entity-chip-tag').map((n) => n.textContent)).toEqual(['VIP']);
    fireEvent.click(screen.getByRole('button', { name: /Kay One/ }));
    // The selected value plus the Kay One option; Lee Two has none.
    expect(screen.getAllByTestId('entity-chip-tag')).toHaveLength(2);
  });

  it('ClientPicker (in-memory) shows display tags on the selected value and options', () => {
    const clients = [
      { client_id: 'a', client_name: 'Acme', client_type: 'company', is_inactive: false, displayTags: [vip] },
      { client_id: 'b', client_name: 'Beta', client_type: 'company', is_inactive: false },
    ] as any[];
    const { container } = render(<ClientPicker id="clp" clients={clients} selectedClientId="a" onSelect={() => {}} />);
    expect(screen.getAllByTestId('entity-chip-tag').map((n) => n.textContent)).toEqual(['VIP']);
    fireEvent.click(container.querySelector('[aria-haspopup="listbox"]') as HTMLElement);
    expect(screen.getAllByTestId('entity-chip-tag')).toHaveLength(2);
  });
});
