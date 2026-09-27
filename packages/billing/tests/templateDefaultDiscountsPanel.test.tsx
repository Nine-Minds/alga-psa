/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const actions = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContractById: actions.get, updateContract: actions.update,
}));
vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  getTemplateLineServicesWithConfigurations: vi.fn(async () => []),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_: string, options: { defaultValue: string }) => options.defaultValue }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ variant, children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ label, ...props }: any) => <label>{label}<input {...props} /></label>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ options, value, onValueChange, id }: any) => <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));

import TemplateDefaultDiscountsPanel from '../src/components/billing-dashboard/contracts/TemplateDefaultDiscountsPanel';

const terms = [
  { template_discount_key: 'term-one', discount_name: 'Default ten percent', discount_type: 'percentage', value: 10, start_date: '2026-09-01', end_date: null, scope: 'contract', is_active: true, priority: 7 },
  { template_discount_key: 'term-two', discount_name: 'Fixed credit', discount_type: 'fixed', value: 50, start_date: '2026-09-01', scope: 'contract', is_active: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  actions.get.mockResolvedValue({ template_metadata: { default_discounts: terms, usage_notes: 'Preserve these notes' } });
  actions.update.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('adds a template discount when the browser has no secure-context randomUUID API', async () => {
  vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  const saved = vi.fn();
  render(<TemplateDefaultDiscountsPanel templateId="template" definitions={terms} lines={[]} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText('Discount name'), { target: { value: 'New default' } });
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: '12.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add default discount' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const persisted = actions.update.mock.calls[0][1].template_metadata.default_discounts;
  expect(persisted.slice(0, 2)).toEqual(terms);
  expect(persisted[2]).toMatchObject({ discount_name: 'New default', value: 12.5, scope: 'contract' });
  expect(persisted[2].template_discount_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

it('edits a template term in place, preserving identity, priority, peers and unrelated metadata', async () => {
  const saved = vi.fn();
  render(<TemplateDefaultDiscountsPanel templateId="template" definitions={terms} lines={[]} onSaved={saved} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  expect(screen.getByLabelText('Value')).toHaveValue(10);
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(actions.update).toHaveBeenCalledWith('template', {
    template_metadata: {
      usage_notes: 'Preserve these notes',
      default_discounts: [
        { ...terms[0], value: 15, contract_line_id: null, scope_service_id: null }, terms[1],
      ],
    },
  });
  expect(screen.getByRole('button', { name: 'Add default discount' })).toBeInTheDocument();
});

it('cancels an edit without writing and keeps the form open when the server rejects a save', async () => {
  render(<TemplateDefaultDiscountsPanel templateId="template" definitions={terms} lines={[]} onSaved={vi.fn()} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: '101' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(actions.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  actions.update.mockResolvedValue({ actionError: 'Percentage must not exceed 100.' });
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: '101' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Percentage must not exceed 100.')).toBeInTheDocument();
  expect(screen.getByLabelText('Value')).toHaveValue(101);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});
