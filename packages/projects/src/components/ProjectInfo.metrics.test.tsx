/** @vitest-environment jsdom */
import React, { act } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@alga-psa/types';

const harness = vi.hoisted(() => ({
  calculate: vi.fn<(projectId: string) => Promise<any>>(),
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
}));

vi.mock('@alga-psa/projects/lib/projectUtils', () => ({
  calculateProjectCompletion: (projectId: string) => harness.calculate(projectId),
}));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer: harness.openDrawer, closeDrawer: harness.closeDrawer }) }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ isActionMessageError: () => false, isActionPermissionError: () => false }));
vi.mock('@alga-psa/ui/components/BackNav', () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, asChild: _asChild, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/ShareActionsMenu', () => ({ ShareActionsMenu: () => null }));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('../context/ProjectBillingIntegrationContext', () => ({ useProjectBillingIntegration: () => null }));
vi.mock('./TaskShareActionsContext', () => ({ useTaskShareActions: () => ({}) }));
vi.mock('./TaskSelectionContext', () => ({ useTaskSelection: () => ({ selectedTaskIds: new Set() }) }));
vi.mock('./ProjectDetailsEdit', () => ({ default: () => null }));
vi.mock('./project-templates/CreateTemplateDialog', () => ({ default: () => null }));
vi.mock('./ProjectMaterialsDrawer', () => ({ default: () => null }));
vi.mock('./ProjectTaskExportDialog', () => ({ default: () => null }));
vi.mock('./SendStatusUpdateDialog', () => ({ default: () => null }));
vi.mock('./HoursProgressBar', () => ({ default: () => null }));

import ProjectInfo from './ProjectInfo';

const project = {
  project_id: 'project-1',
  project_name: 'Test Project',
  project_number: 'PRJ-100',
  client_id: 'client-1',
  client_name: 'Client One',
} as IProject;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('ProjectInfo budget metrics rendering', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    harness.calculate.mockReset();
    harness.openDrawer.mockReset();
    harness.closeDrawer.mockReset();
  });

  afterEach(() => cleanup());

  it('keeps redacted budget and derived metrics unavailable after the action resolves', async () => {
    const response = deferred<any>();
    harness.calculate.mockReturnValue(response.promise);
    render(<ProjectInfo project={project} users={[]} clients={[]} phases={[]} />);

    await act(async () => {
      response.resolve({
        taskCompletionPercentage: 50,
        hoursCompletionPercentage: null,
        budgetedHours: null,
        spentHours: 12.2,
        remainingHours: null,
      });
      await response.promise;
    });

    expect(harness.calculate).toHaveBeenCalledWith('project-1');
    expect(screen.queryByText('Budget:')).toBeNull();
    expect(screen.queryByText('{{spent}} of {{budgeted}} hours')).toBeNull();
  });

  it('renders authorized unredacted budget metrics as a control', async () => {
    const response = deferred<any>();
    harness.calculate.mockReturnValue(response.promise);
    render(<ProjectInfo project={project} users={[]} clients={[]} phases={[]} />);

    await act(async () => {
      response.resolve({
        taskCompletionPercentage: 50,
        hoursCompletionPercentage: 25,
        budgetedHours: 48,
        spentHours: 12,
        remainingHours: 36,
      });
      await response.promise;
    });

    expect(screen.getByText('Budget:')).not.toBeNull();
    expect(screen.getByText('{{spent}} of {{budgeted}} hours')).not.toBeNull();
  });
});
