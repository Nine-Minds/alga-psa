/**
 * @vitest-environment jsdom
 *
 * The default meeting-organizer controls (formerly a "Teams Meetings" tab inside
 * AvailabilitySettings) were relocated to the dedicated Teams integration
 * settings surface in commit 5ad47bed3d
 * ("feat(teams-settings): move meeting organizer controls [F049-F050,T072-T073]").
 *
 * These tests assert the relocation contract:
 *   1. AvailabilitySettings no longer renders any Teams meeting-organizer UI and
 *      no longer depends on the meeting-organizer server actions.
 *   2. The meeting-organizer controls + actions now live in
 *      TeamsIntegrationSettings / the integrations teamsActions module.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AvailabilitySettings from '../../../../../packages/scheduling/src/components/schedule/AvailabilitySettings';

const {
  getAvailabilitySettings,
  createOrUpdateAvailabilitySetting,
  deleteAvailabilitySetting,
  getAvailabilityExceptions,
  addAvailabilityException,
  deleteAvailabilityException,
  getServices,
  getAllUsersBasic,
  getTeams,
  useSession,
} = vi.hoisted(() => ({
  getAvailabilitySettings: vi.fn(),
  createOrUpdateAvailabilitySetting: vi.fn(),
  deleteAvailabilitySetting: vi.fn(),
  getAvailabilityExceptions: vi.fn(),
  addAvailabilityException: vi.fn(),
  deleteAvailabilityException: vi.fn(),
  getServices: vi.fn(),
  getAllUsersBasic: vi.fn(),
  getTeams: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  getAvailabilitySettings,
  createOrUpdateAvailabilitySetting,
  deleteAvailabilitySetting,
  getAvailabilityExceptions,
  addAvailabilityException,
  deleteAvailabilityException,
  getServices,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsersBasic,
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => useSession(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Tabs', () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value, onClick }: any) => (
    <button data-value={value} onClick={onClick}>
      {children}
    </button>
  ),
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: any) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options = [], value, onValueChange }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({
  default: () => <div>Picker</div>,
}));

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: (props: any) => <input type="time" {...props} />,
}));

vi.mock('@alga-psa/ui/components/Calendar', () => ({
  Calendar: () => <div>Calendar</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Table', () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: () => <div>Data table</div>,
}));

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('AvailabilitySettings Teams meetings relocation', () => {
  beforeEach(() => {
    useSession.mockReturnValue({
      data: { user: { id: 'user-1' } },
    });
    getTeams.mockResolvedValue([]);
    getAllUsersBasic.mockResolvedValue([]);
    getServices.mockResolvedValue({ services: [] });
    getAvailabilitySettings.mockResolvedValue({ success: true, data: [] });
    getAvailabilityExceptions.mockResolvedValue({ success: true, data: [] });
    createOrUpdateAvailabilitySetting.mockResolvedValue({ success: true });
    deleteAvailabilitySetting.mockResolvedValue({ success: true });
    addAvailabilityException.mockResolvedValue({ success: true });
    deleteAvailabilityException.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('no longer renders the Teams meeting-organizer UI in AvailabilitySettings', async () => {
    render(<AvailabilitySettings isOpen={true} onClose={vi.fn()} />);

    // Wait for the component to finish its initial async loads.
    await screen.findByText('Existing Exceptions');

    expect(screen.queryByText('Teams Meetings')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Default meeting organizer (UPN or Microsoft user ID)')
    ).not.toBeInTheDocument();
  });

  it('AvailabilitySettings source no longer wires the meeting-organizer actions', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'packages/scheduling/src/components/schedule/AvailabilitySettings.tsx'),
      'utf8'
    );

    expect(source).not.toContain('getTeamsMeetingsTabState');
    expect(source).not.toContain('setDefaultMeetingOrganizer');
    expect(source).not.toContain('verifyMeetingOrganizer');
  });

  it('the meeting-organizer controls now live in TeamsIntegrationSettings', () => {
    const teamsSettingsSource = fs.readFileSync(
      path.join(
        repoRoot,
        'packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx'
      ),
      'utf8'
    );

    expect(teamsSettingsSource).toContain('teams-default-meeting-organizer-upn');
    expect(teamsSettingsSource).toContain('defaultMeetingOrganizerUpn');
    expect(teamsSettingsSource).toContain('saveTeamsIntegrationSettings');
  });
});
