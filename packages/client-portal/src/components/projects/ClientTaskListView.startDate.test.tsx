/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { IClientPortalConfig } from '@alga-psa/types';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
  }),
}));
vi.mock('@alga-psa/ui', () => ({ getDateFnsLocale: () => undefined }));
vi.mock('@alga-psa/ui/hooks', () => ({
  // Every column fits; what shows is then decided by the project's settings alone.
  useResponsiveColumns: () => ({ containerRef: { current: null }, isColumnVisible: () => true, hiddenColumnCount: 0 }),
}));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Spinner', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/UserAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({ default: () => null }));
vi.mock('./TaskDocumentUpload', () => ({ default: () => null }));

import ClientTaskListView from './ClientTaskListView';

afterEach(cleanup);

const phases = [{ phase_id: 'p1', phase_name: 'Build', wbs_code: '1' }] as any;
const tasks = [
  {
    task_id: 't1',
    phase_id: 'p1',
    task_name: 'Rack the switch',
    status_name: 'To Do',
    project_status_mapping_id: 's1',
    start_date: new Date(2026, 9, 5),
    due_date: new Date(2026, 9, 9),
  },
  {
    task_id: 't2',
    phase_id: 'p1',
    task_name: 'Patch uplinks',
    status_name: 'To Do',
    project_status_mapping_id: 's1',
    start_date: null,
    due_date: new Date(2026, 9, 12),
  },
] as any;

function renderList(fields: string[]) {
  const config: IClientPortalConfig = { show_phases: true, show_tasks: true, visible_task_fields: fields };
  const { container } = render(<ClientTaskListView phases={phases} tasks={tasks} config={config} />);
  // Status groups start collapsed; open them all to reach the task rows.
  let guard = 0;
  while (!container.textContent?.includes('Rack the switch') && guard < 5) {
    container.querySelectorAll('tr').forEach((row) => {
      if (!container.textContent?.includes('Rack the switch')) (row as HTMLElement).click();
    });
    guard += 1;
  }
  const headers = Array.from(container.querySelectorAll('th')).map((th) => th.textContent?.trim() ?? '');
  return { container, headers, text: container.textContent ?? '' };
}

describe('ClientTaskListView start date', () => {
  it('shows a Start Date column before Due Date when the project enables it', () => {
    const { headers, text } = renderList(['task_name', 'start_date', 'due_date']);
    expect(headers).toContain('Start Date');
    expect(headers.indexOf('Start Date')).toBe(headers.indexOf('tasks.dueDate') - 1);
    expect(text).toContain('Rack the switch');
    expect(text).toContain('Oct 5, 2026');
    expect(text).toContain('Oct 9, 2026');
  });

  it('leaves the cell empty for a task without a start date', () => {
    const { container } = renderList(['task_name', 'start_date', 'due_date']);
    const row = Array.from(container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Patch uplinks'))!;
    expect(row.textContent).toContain('Oct 12, 2026');
    expect(row.textContent).not.toContain('Oct 5, 2026');
  });

  it('shows neither the column nor the date when the project has not enabled it', () => {
    const { headers, text } = renderList(['task_name', 'due_date']);
    expect(headers).not.toContain('Start Date');
    expect(text).toContain('Rack the switch');
    // The start date is in the task data here, yet must not be rendered.
    expect(text).not.toContain('Oct 5, 2026');
    expect(text).toContain('Oct 9, 2026');
  });
});
