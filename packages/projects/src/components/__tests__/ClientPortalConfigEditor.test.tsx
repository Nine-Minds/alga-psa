/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ClientPortalConfigEditor from '../ClientPortalConfigEditor';
import type { IClientPortalConfig } from '@alga-psa/types';
import { DEFAULT_CLIENT_PORTAL_CONFIG } from '@alga-psa/types';

function buildConfig(overrides: Partial<IClientPortalConfig> = {}): IClientPortalConfig {
  return { ...DEFAULT_CLIENT_PORTAL_CONFIG, ...overrides };
}

function getBudgetHoursSwitch(): HTMLElement {
  // Radix Switch renders a <button role="switch"> — our Switch wrapper attaches
  // data-automation-id from the `id` prop ("show-budget-hours").
  const el = document.querySelector('[data-automation-id="show-budget-hours"]');
  if (!el) throw new Error('show-budget-hours switch not found');
  return el as HTMLElement;
}

describe('ClientPortalConfigEditor — Show Budget Hours toggle', () => {
  afterEach(cleanup);

  it('renders a toggle bound to the show_budget_hours field', () => {
    render(
      <ClientPortalConfigEditor
        config={buildConfig()}
        onChange={() => {}}
      />
    );
    // The toggle exists — identified by its data-automation-id, which comes
    // from the `id="show-budget-hours"` on the Switch.
    expect(getBudgetHoursSwitch()).toBeInTheDocument();
  });

  it('reflects show_budget_hours=false via aria-checked=false', () => {
    render(
      <ClientPortalConfigEditor
        config={buildConfig({ show_budget_hours: false })}
        onChange={() => {}}
      />
    );

    const toggle = getBudgetHoursSwitch();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('reflects show_budget_hours=true via aria-checked=true', () => {
    render(
      <ClientPortalConfigEditor
        config={buildConfig({ show_budget_hours: true })}
        onChange={() => {}}
      />
    );

    const toggle = getBudgetHoursSwitch();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('calls onChange with show_budget_hours=true when the toggle is clicked from off', () => {
    const onChange = vi.fn();
    render(
      <ClientPortalConfigEditor
        config={buildConfig({ show_budget_hours: false })}
        onChange={onChange}
      />
    );

    fireEvent.click(getBudgetHoursSwitch());

    expect(onChange).toHaveBeenCalledTimes(1);
    const nextConfig = onChange.mock.calls[0][0] as IClientPortalConfig;
    expect(nextConfig.show_budget_hours).toBe(true);
    // Unrelated flags are preserved.
    expect(nextConfig.show_phases).toBe(false);
    expect(nextConfig.show_tasks).toBe(false);
  });

  it('calls onChange with show_budget_hours=false when the toggle is clicked from on', () => {
    const onChange = vi.fn();
    render(
      <ClientPortalConfigEditor
        config={buildConfig({ show_budget_hours: true })}
        onChange={onChange}
      />
    );

    fireEvent.click(getBudgetHoursSwitch());

    expect(onChange).toHaveBeenCalledTimes(1);
    const nextConfig = onChange.mock.calls[0][0] as IClientPortalConfig;
    expect(nextConfig.show_budget_hours).toBe(false);
  });

  it('disables the toggle when the editor is disabled', () => {
    render(
      <ClientPortalConfigEditor
        config={buildConfig()}
        onChange={() => {}}
        disabled
      />
    );

    const toggle = getBudgetHoursSwitch();
    expect(toggle).toBeDisabled();
  });

  it('is independent of show_phases — does not auto-disable when phases turn off', () => {
    const onChange = vi.fn();
    render(
      <ClientPortalConfigEditor
        config={buildConfig({ show_phases: true, show_budget_hours: true })}
        onChange={onChange}
      />
    );

    // Toggle off show_phases — the Phases switch sits above Budget Hours visually
    // but the two are independent state-wise.
    const phasesToggle = document.querySelector(
      '[data-automation-id="show-phases"]'
    ) as HTMLElement;
    fireEvent.click(phasesToggle);

    expect(onChange).toHaveBeenCalledTimes(1);
    const nextConfig = onChange.mock.calls[0][0] as IClientPortalConfig;
    expect(nextConfig.show_phases).toBe(false);
    // Budget Hours stays on — it's not nested under phases.
    expect(nextConfig.show_budget_hours).toBe(true);
  });
});

describe('ClientPortalConfigEditor — project billing', () => {
  afterEach(cleanup);

  it('shows the Show Billing toggle and summary', () => {
    render(
      <ClientPortalConfigEditor
        config={buildConfig({ show_billing: true })}
        onChange={() => {}}
      />
    );

    expect(document.querySelector('[data-automation-id="show-billing"]')).toBeInTheDocument();
    expect(screen.getByText(/Billing summary:/)).toBeInTheDocument();
  });
});

describe('ClientPortalConfigEditor — task start date field', () => {
  afterEach(() => cleanup());

  const withTasks = (fields: string[]) =>
    buildConfig({ show_phases: true, show_tasks: true, visible_task_fields: fields });
  const startDateCheckbox = () => document.getElementById('field-start_date') as HTMLInputElement | null;

  it('offers Start Date as an optional task field, just before Due Date', () => {
    render(<ClientPortalConfigEditor config={withTasks(['task_name', 'due_date', 'status'])} onChange={() => {}} />);
    const start = startDateCheckbox();
    expect(start).not.toBeNull();
    expect(start!.disabled).toBe(false);
    const ids = Array.from(document.querySelectorAll('[id^="field-"]')).map((el) => el.id);
    expect(ids.indexOf('field-start_date')).toBe(ids.indexOf('field-due_date') - 1);
  });

  it('is off by default, so existing projects do not start exposing start dates', () => {
    expect(DEFAULT_CLIENT_PORTAL_CONFIG.visible_task_fields).not.toContain('start_date');
    render(<ClientPortalConfigEditor config={withTasks(DEFAULT_CLIENT_PORTAL_CONFIG.visible_task_fields ?? [])} onChange={() => {}} />);
    expect(startDateCheckbox()!.checked).toBe(false);
  });

  it('adds and removes start_date from the visible fields without touching the others', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ClientPortalConfigEditor config={withTasks(['task_name', 'due_date'])} onChange={onChange} />
    );
    fireEvent.click(startDateCheckbox()!);
    const enabled = onChange.mock.calls[0][0] as IClientPortalConfig;
    expect([...(enabled.visible_task_fields ?? [])].sort()).toEqual(['due_date', 'start_date', 'task_name']);

    rerender(<ClientPortalConfigEditor config={enabled} onChange={onChange} />);
    expect(startDateCheckbox()!.checked).toBe(true);
    fireEvent.click(startDateCheckbox()!);
    const disabledAgain = onChange.mock.calls[1][0] as IClientPortalConfig;
    expect([...(disabledAgain.visible_task_fields ?? [])].sort()).toEqual(['due_date', 'task_name']);
  });
});
