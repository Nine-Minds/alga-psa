// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DisplaySettings from '@alga-psa/tickets/components/settings/DisplaySettings';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: mocks.get,
  updateTicketingDisplaySettings: mocks.update,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@alga-psa/ui/lib', () => ({ useDateFormat: () => ({ country: 'US' }) }));
vi.mock('@alga-psa/tickets/lib', () => ({
  TOGGLEABLE_TICKET_COLUMNS: [],
  resolveTicketColumnVisibility: () => ({}),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
    <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange, label }: {
    id: string; checked: boolean; onCheckedChange: (value: boolean) => void; label: string;
  }) => (
    <label htmlFor={id}>{label}<input id={id} type="checkbox" checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)} /></label>
  ),
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) =>
    <label>{label}<input type="checkbox" {...props} /></label>,
}));

describe('Ticketing Display default reply switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ responseStateTrackingEnabled: true });
    mocks.update.mockResolvedValue({ success: true });
  });

  it('is off by default and saves the tenant-wide setting when enabled', async () => {
    render(<DisplaySettings />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    const toggle = screen.getByRole('checkbox', { name: 'Default ticket replies to Internal' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ defaultReplyInternal: true })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  });

  it('loads the saved setting and can disable it', async () => {
    mocks.get.mockResolvedValue({ defaultReplyInternal: true, responseStateTrackingEnabled: true });
    render(<DisplaySettings />);
    const toggle = screen.getByRole('checkbox', { name: 'Default ticket replies to Internal' });
    await waitFor(() => expect(toggle).toBeChecked());
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ defaultReplyInternal: false })));
  });

  it('does not mark a rejected save as successful', async () => {
    mocks.update.mockRejectedValue(new Error('Save failed'));
    render(<DisplaySettings />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Default ticket replies to Internal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
