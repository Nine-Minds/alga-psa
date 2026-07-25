// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraScheduleTab } from '@ee/components/settings/integrations/entra/EntraScheduleTab';

const { saveEntraSyncScheduleMock } = vi.hoisted(() => ({
  saveEntraSyncScheduleMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  saveEntraSyncSchedule: saveEntraSyncScheduleMock,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
    disabled,
  }: {
    id: string;
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  CustomSelect: ({
    id,
    value,
    onValueChange,
    options,
    disabled,
  }: {
    id: string;
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    disabled?: boolean;
  }) => (
    <select id={id} value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const enabledToggle = () => document.getElementById('entra-schedule-enabled') as HTMLInputElement;
const saveButton = () => document.getElementById('entra-schedule-save') as HTMLButtonElement;

describe('EntraScheduleTab', () => {
  beforeEach(() => {
    saveEntraSyncScheduleMock.mockReset();
    saveEntraSyncScheduleMock.mockResolvedValue({
      success: true,
      data: { syncEnabled: true, syncIntervalMinutes: 240, updatedAt: null, scheduleApplied: true },
    });
  });

  it('writes the schedule settings an operator chooses', async () => {
    render(
      <EntraScheduleTab
        schedule={{ syncEnabled: false, syncIntervalMinutes: 1440, updatedAt: null }}
        hasCompletedPilot={false}
        onSaved={vi.fn()}
      />
    );

    fireEvent.click(enabledToggle());
    fireEvent.change(document.getElementById('entra-schedule-interval') as HTMLSelectElement, {
      target: { value: '240' },
    });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(saveEntraSyncScheduleMock).toHaveBeenCalledWith({
        syncEnabled: true,
        syncIntervalMinutes: 240,
      })
    );
    expect(await screen.findByText('Schedule saved.')).toBeInTheDocument();
  });

  it('says the schedule lags rather than claiming success when Temporal was unreachable', async () => {
    saveEntraSyncScheduleMock.mockResolvedValue({
      success: true,
      data: {
        syncEnabled: true,
        syncIntervalMinutes: 1440,
        updatedAt: null,
        scheduleApplied: false,
        scheduleError: 'Temporal client not available',
      },
    });

    render(
      <EntraScheduleTab
        schedule={{ syncEnabled: false, syncIntervalMinutes: 1440, updatedAt: null }}
        hasCompletedPilot={false}
        onSaved={vi.fn()}
      />
    );

    fireEvent.click(enabledToggle());
    fireEvent.click(saveButton());

    expect(
      await screen.findByText(/The schedule itself will update when the worker next reconciles/)
    ).toBeInTheDocument();
  });

  it('prompts to turn automatic sync on only after a pilot has succeeded', () => {
    const { unmount } = render(
      <EntraScheduleTab
        schedule={{ syncEnabled: false, syncIntervalMinutes: 1440, updatedAt: null }}
        hasCompletedPilot={false}
        onSaved={vi.fn()}
      />
    );
    expect(document.getElementById('entra-schedule-prompt')).toBeNull();
    unmount();

    render(
      <EntraScheduleTab
        schedule={{ syncEnabled: false, syncIntervalMinutes: 1440, updatedAt: null }}
        hasCompletedPilot
        onSaved={vi.fn()}
      />
    );
    expect(document.getElementById('entra-schedule-prompt')?.textContent).toContain(
      'Turn on automatic sync'
    );
  });

  it('does not prompt when automatic sync is already on', () => {
    render(
      <EntraScheduleTab
        schedule={{ syncEnabled: true, syncIntervalMinutes: 1440, updatedAt: null }}
        hasCompletedPilot
        onSaved={vi.fn()}
      />
    );
    expect(document.getElementById('entra-schedule-prompt')).toBeNull();
  });
});
