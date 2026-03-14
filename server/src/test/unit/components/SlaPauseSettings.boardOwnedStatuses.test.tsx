/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const {
  mockGetSlaSettings,
  mockUpdateSlaSettings,
  mockGetStatusSlaPauseConfigs,
  mockGetBoardOwnedTicketStatusesForSlaPauseConfig,
  mockBulkUpdateStatusSlaPauseConfigs,
  mockGetResponseStateTrackingSetting,
  mockUpdateResponseStateTrackingSetting,
  mockToastSuccess,
  mockHandleError,
} = vi.hoisted(() => ({
  mockGetSlaSettings: vi.fn(),
  mockUpdateSlaSettings: vi.fn(),
  mockGetStatusSlaPauseConfigs: vi.fn(),
  mockGetBoardOwnedTicketStatusesForSlaPauseConfig: vi.fn(),
  mockBulkUpdateStatusSlaPauseConfigs: vi.fn(),
  mockGetResponseStateTrackingSetting: vi.fn(),
  mockUpdateResponseStateTrackingSetting: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockHandleError: vi.fn(),
}));

vi.mock('../../../../../packages/sla/src/actions', () => ({
  __esModule: true,
  getSlaSettings: mockGetSlaSettings,
  updateSlaSettings: mockUpdateSlaSettings,
  getStatusSlaPauseConfigs: mockGetStatusSlaPauseConfigs,
  getBoardOwnedTicketStatusesForSlaPauseConfig: mockGetBoardOwnedTicketStatusesForSlaPauseConfig,
  bulkUpdateStatusSlaPauseConfigs: mockBulkUpdateStatusSlaPauseConfigs,
  getResponseStateTrackingSetting: mockGetResponseStateTrackingSetting,
  updateResponseStateTrackingSetting: mockUpdateResponseStateTrackingSetting,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  __esModule: true,
  Switch: ({ id, checked, disabled, onCheckedChange }: any) => (
    <input
      id={id}
      type="checkbox"
      checked={Boolean(checked)}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  __esModule: true,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  __esModule: true,
  Card: ({ children }: any) => <section>{children}</section>,
  CardHeader: ({ children }: any) => <header>{children}</header>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  __esModule: true,
  Checkbox: ({ id, checked, disabled, onChange }: any) => (
    <input
      id={id}
      type="checkbox"
      checked={Boolean(checked)}
      disabled={disabled}
      onChange={onChange}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  __esModule: true,
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  __esModule: true,
  default: ({ text }: any) => <div>{text}</div>,
}));

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: mockToastSuccess },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  __esModule: true,
  handleError: mockHandleError,
}));

import { SlaPauseSettings } from '../../../../../packages/sla/src/components/SlaPauseSettings';

describe('SlaPauseSettings board-owned ticket statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSlaSettings.mockResolvedValue({
      tenant: 'tenant-1',
      pause_on_awaiting_client: true,
    });
    mockUpdateSlaSettings.mockResolvedValue({
      tenant: 'tenant-1',
      pause_on_awaiting_client: false,
    });
    mockGetStatusSlaPauseConfigs.mockResolvedValue([
      {
        tenant: 'tenant-1',
        config_id: 'config-1',
        status_id: 'status-b-pending',
        pauses_sla: true,
      },
    ]);
    mockGetBoardOwnedTicketStatusesForSlaPauseConfig.mockResolvedValue([
      {
        status_id: 'status-a-pending',
        board_id: 'board-a',
        board_name: 'Help Desk',
        name: 'Pending Customer',
        is_closed: false,
        order_number: 10,
      },
      {
        status_id: 'status-b-pending',
        board_id: 'board-b',
        board_name: 'Billing',
        name: 'Pending Customer',
        is_closed: false,
        order_number: 10,
      },
    ]);
    mockBulkUpdateStatusSlaPauseConfigs.mockResolvedValue([]);
    mockGetResponseStateTrackingSetting.mockResolvedValue(true);
    mockUpdateResponseStateTrackingSetting.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('T047: renders board-owned statuses with board context and saves board-owned ids only', async () => {
    const user = userEvent.setup();

    render(<SlaPauseSettings />);

    await waitFor(() => {
      expect(screen.getByText('Help Desk')).toBeInTheDocument();
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });

    const helpDeskCheckbox = document.getElementById('status-pause-status-a-pending') as HTMLInputElement | null;
    const billingCheckbox = document.getElementById('status-pause-status-b-pending') as HTMLInputElement | null;

    expect(helpDeskCheckbox).not.toBeNull();
    expect(billingCheckbox).not.toBeNull();
    expect(helpDeskCheckbox).not.toBeChecked();
    expect(billingCheckbox).toBeChecked();

    await user.click(helpDeskCheckbox!);
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockBulkUpdateStatusSlaPauseConfigs).toHaveBeenCalledWith([
        {
          statusId: 'status-a-pending',
          pausesSla: true,
        },
      ]);
    });
  });
});
