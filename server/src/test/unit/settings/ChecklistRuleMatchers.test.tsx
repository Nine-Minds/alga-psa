import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PredicateGroup } from '@alga-psa/predicates';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, label, options, onValueChange, value, disabled }: any) => (
    <label htmlFor={id}>
      {label}
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option: any) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, onSelect }: any) => (
    <button id={id} onClick={() => onSelect('11111111-1111-4111-8111-111111111111')}>
      Pick client
    </button>
  ),
}));
vi.mock('@alga-psa/clients/actions/clientPickerActions', () => ({ searchClientsForPicker: vi.fn() }));

import ChecklistRuleMatchers from '../../../components/settings/general/ChecklistRuleMatchers';

const P = 'ticketing.checklistTemplates.predicate';
const tag = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const props = (where: PredicateGroup = { join: 'and', clauses: [] }) => ({
  rule: { apply_rule_id: 'rule', template_id: 'template', where, where_version: 1, is_enabled: false },
  index: 0,
  options: { boards: [{ value: tag, label: 'Help Desk' }] },
  tags: { client: [{ tag_id: tag, tag_text: 'Managed M365' }] as any[], contact: [] as any[] },
  clientNames: {},
  onClientPicked: vi.fn(),
  onChange: vi.fn(async () => undefined),
});
afterEach(cleanup);

describe('descriptor-driven checklist rule editor', () => {
  it('writes tag definition ids and has-none through the shared tag path descriptor', async () => {
    const input = props();
    render(<ChecklistRuleMatchers {...input} />);
    fireEvent.click(screen.getByText(`${P}.add`));
    fireEvent.change(screen.getByLabelText(`${P}.field`), { target: { value: 'client.tags' } });
    fireEvent.change(screen.getByLabelText(`${P}.operator`), { target: { value: 'not_in' } });
    const list = screen.getByLabelText(`${P}.value`) as HTMLSelectElement;
    list.options[0].selected = true;
    fireEvent.change(list);
    fireEvent.click(screen.getByText(`${P}.save`));
    expect(input.onChange).toHaveBeenCalledWith({
      join: 'and',
      clauses: [{ path: 'client.tags', operator: 'not_in', value: [tag] }],
    });
  });

  it.each([['OnBoarding İ', 'onboarding i\u0307'], ['A\ua7ceΣ', 'a\ua7ceσ']])(
    'folds %j on explicit save without persisting partial typing', async (typed, folded) => {
      const input = props();
      render(<ChecklistRuleMatchers {...input} />);
      fireEvent.click(screen.getByText(`${P}.add`));
      fireEvent.change(screen.getByLabelText(`${P}.field`), { target: { value: 'title_folded' } });
      fireEvent.change(screen.getByLabelText(`${P}.operator`), { target: { value: 'contains' } });
      fireEvent.change(screen.getByLabelText(`${P}.value`), { target: { value: typed } });
      expect(input.onChange).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText(`${P}.save`));
      expect(input.onChange).toHaveBeenCalledWith({
        join: 'and',
        clauses: [{ path: 'title_folded', operator: 'contains', value: folded }],
      });
    },
  );

  it('renders nested persisted predicates read-only and preserves them across enabled-state changes', () => {
    const where: PredicateGroup = {
      join: 'and',
      clauses: [
        {
          join: 'or',
          clauses: [
            { path: 'title_folded', operator: 'contains', value: 'onboarding' },
            { path: 'description_folded', operator: 'contains', value: 'onboarding' },
          ],
        },
      ],
    };
    const input = props(where);
    const view = render(<ChecklistRuleMatchers {...input} />);
    expect(screen.getByText(`${P}.advanced`)).toBeTruthy();
    expect(screen.queryByText(`${P}.save`)).toBeNull();
    view.rerender(<ChecklistRuleMatchers {...input} rule={{ ...input.rule, is_enabled: true }} />);
    expect(screen.getAllByText(/onboarding/)).toHaveLength(2);
    expect(input.onChange).not.toHaveBeenCalled();
    expect(input.rule.where).toEqual(where);
  });

  it('keeps the owned client control read-only', () => {
    const input = props({ join: 'and', clauses: [{ path: 'client.id', operator: 'equals', value: tag }] });
    render(<ChecklistRuleMatchers {...input} ownerClientName="Emerald City" />);
    expect((screen.getByLabelText(`${P}.field`) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText(`${P}.operator`) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByText('Pick client')).toBeNull();
    expect(screen.getByText('Emerald City')).toBeTruthy();
  });

  it('preserves unavailable tag ids when another tag is selected', () => {
    const input = props({ join: 'and', clauses: [{ path: 'client.tags', operator: 'in', value: [other] }] });
    render(<ChecklistRuleMatchers {...input} />);
    const list = screen.getByLabelText(`${P}.value`) as HTMLSelectElement;
    expect(list.selectedOptions[0].value).toBe(other);
    list.options[0].selected = true;
    fireEvent.change(list);
    fireEvent.click(screen.getByText(`${P}.save`));
    expect(input.onChange).toHaveBeenCalledWith({
      join: 'and',
      clauses: [{ path: 'client.tags', operator: 'in', value: [tag, other] }],
    });
  });
});
