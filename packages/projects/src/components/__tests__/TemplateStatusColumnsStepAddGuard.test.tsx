/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TemplateStatusColumnsStep } from '../project-templates/wizard-steps/TemplateStatusColumnsStep';
import type { TemplateWizardData } from '../../types/templateWizard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('../../actions/projectTaskStatusActions', () => ({
  createTenantProjectStatus: vi.fn(),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title }: any) => (isOpen ? <div>{title}{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, type = 'button', ...props }: any) => (
    <button type={type} {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/ColorPicker', () => ({
  default: ({ trigger }: any) => <div>{trigger}</div>,
}));

vi.mock('@alga-psa/ui/components/QuickAddStatus', () => ({
  QuickAddStatus: () => null,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ value, onValueChange, options, id }: any) => (
    <select id={id} data-testid="custom-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

const DICT: Record<string, string> = {
  'settings.statuses.add_existing': 'Add Existing',
  'templates.statuses.pending_row_hint': 'Fill in the empty status column before adding another one.',
  'templates.statuses.select_placeholder': 'Select a status...',
  'templates.statuses.create_new': 'Create New',
};

function translate(key: string, arg2?: unknown): string {
  if (typeof arg2 === 'string') return arg2;
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  const template = DICT[key] ?? (typeof opts.defaultValue === 'string' ? opts.defaultValue : key);
  return template.replace(/{{\s*(\w+)\s*}}/g, (_m, name: string) => String(opts[name] ?? ''));
}

const AVAILABLE = [
  { status_id: 's1', name: 'To Do', color: '#111111', is_closed: false },
  { status_id: 's2', name: 'In Progress', color: '#222222', is_closed: false },
  { status_id: 's3', name: 'Done', color: '#333333', is_closed: true },
];

function Harness() {
  const [data, setData] = useState<TemplateWizardData>({
    template_name: 'Walkthrough Template',
    status_mappings: [
      { temp_id: 'm1', status_id: 's1', display_order: 0, statusSource: 'tenant' },
      { temp_id: 'm2', status_id: 's2', display_order: 1, statusSource: 'tenant' },
    ],
    phases: [],
    tasks: [],
    checklist_items: [],
  });

  return (
    <TemplateStatusColumnsStep
      data={data}
      updateData={(patch) => setData((previous) => ({ ...previous, ...patch }))}
      availableStatuses={AVAILABLE}
      isLoadingStatuses={false}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe('TemplateStatusColumnsStep add-status guard', () => {
  it('does not spawn a second empty row when Add Existing is clicked twice', () => {
    const { container } = render(<Harness />);

    const addButton = () => container.querySelector('#add-existing-status') as HTMLButtonElement;

    expect(addButton().textContent).toContain('Add Existing');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    fireEvent.click(addButton());
    expect(screen.getAllByRole('listitem')).toHaveLength(3);

    // The pending row blocks a second append and says why.
    expect(addButton().disabled).toBe(true);
    expect(screen.getByText('Fill in the empty status column before adding another one.')).toBeInTheDocument();

    fireEvent.click(addButton());
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('re-enables Add Existing once the pending row is filled', () => {
    const { container } = render(<Harness />);
    const addButton = () => container.querySelector('#add-existing-status') as HTMLButtonElement;

    fireEvent.click(addButton());
    expect(addButton().disabled).toBe(true);

    const pendingSelect = Array.from(container.querySelectorAll('[id^="wizard-status-select-"]')).at(-1);
    expect(pendingSelect).toBeDefined();
    fireEvent.change(pendingSelect as HTMLElement, { target: { value: 's3' } });

    expect(addButton().disabled).toBe(false);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders every status row control as an explicit type="button"', () => {
    const { container } = render(<Harness />);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('type')).toBe('button');
    }
  });
});
