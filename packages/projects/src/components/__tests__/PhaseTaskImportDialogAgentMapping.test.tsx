/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

/**
 * Agent mapping has to survive the jump straight to import.
 *
 * When every CSV status matches, the agent-resolution step is the last screen
 * before the write, so the dialog regroups the rows with the new resolutions and
 * imports in one handler. Reading the regrouped phases back out of state there
 * returns the pre-mapping value, which silently drops the assignee the user just
 * picked.
 */

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { IImportReferenceData, IPhaseTaskValidationResponse } from '@alga-psa/types';

const UNMATCHED_AGENT = 'Wicked Witch';
const FIRST_USER_ID = 'user-oz';
const MAPPED_USER_ID = 'user-glinda';
const PROJECT_ID = 'project-emerald';

const importPhasesAndTasksMock = vi.hoisted(() => vi.fn());

/**
 * No i18next instance under test, so resolve each call to its inline default and
 * interpolate {{placeholders}} the way i18next would — button labels carry counts.
 */
function translate(key: string, arg2?: unknown): string {
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  const template = typeof arg2 === 'string'
    ? arg2
    : typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
  return template.replace(/{{(\w+)}}/g, (match, name: string) =>
    name in opts ? String(opts[name]) : match);
}

vi.mock('react-i18next', () => ({
  useTranslation: () => {
    const i18n = { isInitialized: true, language: 'en' };
    return Object.assign([translate, i18n, true], { t: translate, i18n, ready: true });
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ formatNumber: (value: number) => String(value) }),
  useTranslation: () => ({ t: translate }),
}));

// Keep the real row grouping — it is what turns an agent resolution into
// assigned_to — and stub only the server round trips around it.
vi.mock('../../actions/phaseTaskImportActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../actions/phaseTaskImportActions')>();

  const referenceData: IImportReferenceData = {
    users: [
      { user_id: 'user-oz', first_name: 'Oscar', last_name: 'Diggs', email: 'oz@emeraldcity.oz' },
      { user_id: 'user-glinda', first_name: 'Glinda', last_name: 'Good', email: 'glinda@emeraldcity.oz' },
    ] as IImportReferenceData['users'],
    priorities: [],
    services: [],
    phases: [],
    statusMappings: [
      {
        project_status_mapping_id: 'psm-open',
        status_name: 'To Do',
        name: 'To Do',
        custom_name: 'To Do',
      },
    ],
    userLookup: {},
    priorityLookup: {},
    serviceLookup: {},
    statusLookup: {},
  } as IImportReferenceData;

  // One task assigned to an agent nobody matches, and no status at all — so the
  // status-resolution screen never appears and import follows agent mapping.
  const validationResponse: IPhaseTaskValidationResponse = {
    validationResults: [
      {
        isValid: true,
        errors: [],
        warnings: [],
        rowNumber: 2,
        data: { csvRowNumber: 2, task_name: 'Melt the witch', assigned_to: 'Wicked Witch' },
      },
    ],
    userLookup: {},
    priorityLookup: {},
    serviceLookup: {},
    statusLookup: {},
    statusLookupByPhase: {},
    unmatchedStatuses: [],
    unmatchedAgents: ['Wicked Witch'],
  };

  return {
    groupRowsIntoPhases: actual.groupRowsIntoPhases,
    generatePhaseTaskCSVTemplate: vi.fn(async () => ''),
    getImportReferenceData: vi.fn(async () => referenceData),
    validatePhaseTaskImportDataWithReferenceData: vi.fn(async () => validationResponse),
    importPhasesAndTasks: importPhasesAndTasksMock,
  };
});

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title, footer }: any) =>
    isOpen ? (
      <div>
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, value, options, onValueChange }: any) => (
    <select
      data-testid={id ?? 'unnamed-select'}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {(options ?? []).map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

// The preview table is irrelevant to the agent hand-off and drags in list plumbing.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: () => null,
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: ({ id, value, users, onValueChange, disabled }: any) => (
    <select
      data-testid={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">none</option>
      {(users ?? []).map((user: any) => (
        <option key={user.user_id} value={user.user_id}>
          {user.email}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn(async () => new Map()),
}));

import PhaseTaskImportDialog from '../PhaseTaskImportDialog';

const CSV = 'task_name,assigned_to\nMelt the witch,Wicked Witch\n';

beforeEach(() => {
  vi.clearAllMocks();
  importPhasesAndTasksMock.mockResolvedValue({
    success: true,
    phasesCreated: 1,
    tasksCreated: 1,
    errors: [],
  });
});

afterEach(() => {
  cleanup();
});

describe('PhaseTaskImportDialog agent mapping', () => {
  it('imports the mapped agent when no status resolution follows', async () => {
    const onImportComplete = vi.fn();

    render(
      <PhaseTaskImportDialog
        isOpen
        onClose={() => undefined}
        projectId={PROJECT_ID}
        onImportComplete={onImportComplete}
      />
    );

    // Upload → mapping (headers auto-map to task_name / assigned_to).
    const file = new File([CSV], 'tasks.csv', { type: 'text/csv' });
    // jsdom's File has no Blob.text(), which the dialog reads the upload with.
    Object.defineProperty(file, 'text', { value: async () => CSV });
    fireEvent.change(document.getElementById('phase-task-csv-upload') as HTMLInputElement, {
      target: { files: [file] },
    });

    const previewButton = await screen.findByRole('button', { name: 'Preview' });

    // Mapping → preview.
    fireEvent.click(previewButton);
    const proceedButton = await screen.findByRole('button', { name: 'Next: Map Agents' });

    // Preview → agent resolution.
    fireEvent.click(proceedButton);
    await screen.findByText(`"${UNMATCHED_AGENT}"`);

    // Choose "map to existing user", then pick a user other than the default.
    const mapToExistingRadio = screen.getByLabelText('Map to existing user:');
    fireEvent.click(mapToExistingRadio);
    const userPicker = screen.getByTestId(`agent-mapping-${UNMATCHED_AGENT}`);
    await waitFor(() => expect(userPicker).toHaveValue(FIRST_USER_ID));
    fireEvent.change(userPicker, { target: { value: MAPPED_USER_ID } });

    // Agent resolution → import (no unmatched statuses, so this is the last screen).
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 Tasks' }));

    await waitFor(() => expect(importPhasesAndTasksMock).toHaveBeenCalledTimes(1));

    const [projectId, groupedPhases] = importPhasesAndTasksMock.mock.calls[0];
    expect(projectId).toBe(PROJECT_ID);
    expect(groupedPhases[0].tasks[0]).toMatchObject({
      task_name: 'Melt the witch',
      assigned_to: MAPPED_USER_ID,
    });
    await waitFor(() => expect(onImportComplete).toHaveBeenCalled());
  });
});
