/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ServiceRequestFormRenderer } from './ServiceRequestFormRenderer';
import type { BasicFormField } from '../../lib/service-requests/formSchema';

const labels = { selectPlaceholder: 'Select an option', datePlaceholder: 'Pick a date' };

function renderForm(
  fields: BasicFormField[],
  overrides: Partial<React.ComponentProps<typeof ServiceRequestFormRenderer>> = {}
) {
  const onValueChange = vi.fn();
  const result = render(
    <ServiceRequestFormRenderer
      fields={fields}
      values={{}}
      onValueChange={onValueChange}
      labels={labels}
      {...overrides}
    />
  );
  return { onValueChange, ...result };
}

afterEach(() => cleanup());

describe('ServiceRequestFormRenderer input types', () => {
  it('renders a control for every input type and names the required ones', () => {
    renderForm([
      { key: 'full_name', type: 'short-text', label: 'Full name', required: true },
      { key: 'summary', type: 'long-text', label: 'Summary' },
      { key: 'quantity', type: 'number', label: 'Quantity' },
      { key: 'contact_email', type: 'email', label: 'Contact email' },
      { key: 'mobile', type: 'phone', label: 'Mobile' },
      { key: 'docs', type: 'url', label: 'Documentation' },
      { key: 'agree', type: 'checkbox', label: 'Agree' },
      {
        key: 'laptop',
        type: 'radio',
        label: 'Laptop model',
        options: [
          { label: 'MacBook Air', value: 'air' },
          { label: 'ThinkPad', value: 'thinkpad' },
        ],
      },
      {
        key: 'peripherals',
        type: 'multi-select',
        label: 'Peripherals',
        options: [
          { label: 'Dock', value: 'dock' },
          { label: 'Headset', value: 'headset' },
        ],
      },
      { key: 'policy', type: 'file-upload', label: 'Signed policy' },
    ]);

    expect(screen.getByRole('textbox', { name: 'Full name *' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Contact email' })).toHaveAttribute('type', 'email');
    expect(screen.getByRole('textbox', { name: 'Mobile' })).toHaveAttribute('type', 'tel');
    expect(screen.getByRole('textbox', { name: 'Documentation' })).toHaveAttribute('type', 'url');
    expect(screen.getByRole('checkbox', { name: 'Agree' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'MacBook Air' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Dock' })).toBeInTheDocument();
    expect(document.getElementById('request-service-field-policy')).toHaveAttribute('type', 'file');
  });

  it('reports a multi-select answer as the list of picked values', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderForm(
      [
        {
          key: 'peripherals',
          type: 'multi-select',
          label: 'Peripherals',
          options: [
            { label: 'Dock', value: 'dock' },
            { label: 'Headset', value: 'headset' },
          ],
        },
      ],
      { values: { peripherals: ['dock'] } }
    );

    await user.click(screen.getByRole('checkbox', { name: 'Headset' }));
    expect(onValueChange).toHaveBeenCalledWith('peripherals', ['dock', 'headset']);
  });
});

describe('ServiceRequestFormRenderer layout', () => {
  const sectioned: BasicFormField[] = [
    { key: 'notice', type: 'callout', label: 'Give us five days', display: { tone: 'warning' } },
    { key: 'employee', type: 'section', label: 'Employee', helpText: "Who's joining." },
    { key: 'full_name', type: 'short-text', label: 'Full name', layout: { width: 'half' } },
    { key: 'start_date', type: 'date', label: 'Start date', layout: { width: 'half' } },
    { key: 'rule', type: 'divider', label: '' },
    { key: 'notes', type: 'text', label: 'A note', helpText: 'Some guidance.' },
  ];

  it('renders display blocks and puts the section around its own questions', () => {
    renderForm(sectioned);

    expect(screen.getByText('Give us five days')).toBeInTheDocument();
    expect(screen.getByText('A note')).toBeInTheDocument();
    expect(screen.getByText('Some guidance.')).toBeInTheDocument();

    const section = screen.getByRole('region', { name: 'Employee' });
    expect(section).toContainElement(document.getElementById('request-service-field-full_name'));
    expect(section).not.toContainElement(document.getElementById('request-service-field-notice'));
  });

  it('pairs two consecutive half-width fields into one two-column row', () => {
    const { container } = renderForm(sectioned);
    const row = document.getElementById('request-service-field-full_name')!.closest('.grid')!;

    expect(row.className).toContain('sm:grid-cols-2');
    expect(row).toContainElement(document.getElementById('request-service-field-start_date'));
    expect(container.querySelectorAll('hr')).toHaveLength(1);
  });

  it('drops the two-column row at phone width', () => {
    renderForm(sectioned, { previewWidth: 'mobile' });
    const row = document.getElementById('request-service-field-full_name')!.closest('.grid')!;
    expect(row.className).not.toContain('sm:grid-cols-2');
  });

  it('keeps a readable measure by default and uses the page when told to', () => {
    const { container, rerender } = renderForm([{ key: 'a', type: 'short-text', label: 'A' }]);
    expect(container.firstElementChild!.className).toContain('max-w-2xl');

    rerender(
      <ServiceRequestFormRenderer
        fields={[{ key: 'a', type: 'short-text', label: 'A' }]}
        settings={{ layout: { width: 'full' } }}
        values={{}}
        onValueChange={() => {}}
        labels={labels}
      />
    );
    expect(container.firstElementChild!.className).not.toContain('max-w-2xl');
  });

  it('renders each authored measure', () => {
    const field = [{ key: 'a', type: 'short-text' as const, label: 'A' }];
    const { container, rerender } = renderForm(field, {
      settings: { layout: { width: 'narrow' } },
    });
    expect(container.firstElementChild!.className).toContain('max-w-md');

    rerender(
      <ServiceRequestFormRenderer
        fields={field}
        settings={{ layout: { width: 'wide' } }}
        values={{}}
        onValueChange={() => {}}
        labels={labels}
      />
    );
    expect(container.firstElementChild!.className).toContain('max-w-4xl');
  });

  it('shows an inline error and points the control at it', () => {
    renderForm([{ key: 'full_name', type: 'short-text', label: 'Full name', required: true }], {
      errors: { full_name: 'This question needs an answer.' },
    });

    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('This question needs an answer.');
    expect(document.getElementById('request-service-field-full_name')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('request-service-field-full_name-error')
    );
  });

  it('folds a collapsible section away and back', async () => {
    const user = userEvent.setup();
    renderForm([
      { key: 'employee', type: 'section', label: 'Employee', display: { collapsible: true } },
      { key: 'full_name', type: 'short-text', label: 'Full name' },
    ]);

    expect(document.getElementById('request-service-field-full_name')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Employee' }));
    expect(document.getElementById('request-service-field-full_name')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Employee' }));
    expect(document.getElementById('request-service-field-full_name')).not.toBeNull();
  });
});
