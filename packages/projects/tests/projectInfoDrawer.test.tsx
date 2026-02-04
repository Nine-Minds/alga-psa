/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IProject } from '@alga-psa/types';

const openDrawer = vi.fn();
const closeDrawer = vi.fn();

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({
    openDrawer,
    closeDrawer,
  }),
}));

vi.mock('@alga-psa/projects/lib/projectUtils', () => ({
  calculateProjectCompletion: vi.fn(async () => ({
    taskCompletionPercentage: 0,
    hoursCompletionPercentage: 0,
    budgetedHours: 0,
    spentHours: 0,
    remainingHours: 0,
  })),
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => null,
}));

vi.mock('../src/components/ProjectDetailsEdit', () => ({
  default: () => null,
}));

vi.mock('../src/components/project-templates/CreateTemplateDialog', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/BackNav', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}));

vi.mock('../src/components/ProjectMaterialsDrawer', () => ({
  default: () => null,
}));

vi.mock('../src/components/HoursProgressBar', () => ({
  default: () => null,
}));

describe('ProjectInfo materials drawer', () => {
  beforeEach(() => {
    openDrawer.mockClear();
    closeDrawer.mockClear();
  });

  it('opens the materials drawer with 560px width (T002)', async () => {
    const project = {
      project_id: 'project-1',
      project_name: 'Test Project',
      project_number: 'PRJ-100',
      client_id: 'client-1',
      client_name: 'Client One',
    } as IProject;

    const ProjectInfo = (await import('../src/components/ProjectInfo')).default;
    render(
      <ProjectInfo
        project={project}
        users={[]}
        clients={[]}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Materials' }));

    expect(openDrawer).toHaveBeenCalledTimes(1);
    const call = openDrawer.mock.calls[0];
    expect(call[3]).toBe('560px');
  });
});
