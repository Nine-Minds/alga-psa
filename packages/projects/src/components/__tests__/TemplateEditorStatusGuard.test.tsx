/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import TemplateEditor from '../project-templates/TemplateEditor';
import type { IProjectTemplateWithDetails } from '@alga-psa/types';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useTruncationDetection: () => ({ ref: () => {}, isTruncated: false }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  handleError: vi.fn(),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/CollapseToggleButton', () => ({
  CollapseToggleButton: () => null,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title, footer, id }: any) =>
    isOpen ? (
      <div data-testid={id}>
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <>{children}</>,
  DropdownMenuItem: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({
  default: () => null,
}));

vi.mock('../ClientPortalConfigEditor', () => ({
  default: () => null,
}));

vi.mock('../project-templates/ApplyTemplateDialog', () => ({
  ApplyTemplateDialog: () => null,
}));

vi.mock('../project-templates/TemplateTaskForm', () => ({
  TemplateTaskForm: () => null,
}));

vi.mock('../project-templates/TemplateTaskListView', () => ({
  default: () => null,
}));

// The Status Manager is rendered on demand; expose a trigger that completes the
// repair so the editor's unresolved count transitions to zero.
vi.mock('../project-templates/TemplateStatusManager', () => ({
  TemplateStatusManager: ({ onStatusReplaced }: any) => (
    <button
      data-testid="mock-repair-done"
      onClick={() => onStatusReplaced?.({ mapping: {}, unresolvedStatusMappingCount: 0 })}
    >
      repair-done
    </button>
  ),
}));

vi.mock('../KanbanZoomControl', () => ({
  default: () => null,
  calculateCardGap: () => 8,
  calculateColumnWidth: () => 260,
  calculateZoomScales: () => [],
}));

vi.mock('../useKanbanPan', () => ({
  useKanbanPan: vi.fn(),
}));

vi.mock('../../actions/projectTemplateActions', () => ({
  deleteTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  addTemplatePhase: vi.fn(),
  updateTemplatePhase: vi.fn(),
  deleteTemplatePhase: vi.fn(),
  reorderTemplatePhase: vi.fn(),
  addTemplateTask: vi.fn(),
  updateTemplateTask: vi.fn(),
  deleteTemplateTask: vi.fn(),
  updateTemplateTaskStatus: vi.fn(),
  setTaskAdditionalAgents: vi.fn(),
  saveTemplateChecklistItems: vi.fn(),
  addTemplateDependency: vi.fn(),
  removeTemplateDependency: vi.fn(),
}));

vi.mock('../../actions/projectTaskStatusActions', () => ({
  getTenantProjectStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../actions/projectTaskActions', () => ({
  getTaskTypes: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getAllPriorities: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsers: vi.fn().mockResolvedValue([]),
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue(new Map()),
  isTeamActionError: () => false,
}));

const DICT: Record<string, string> = {
  'templates.editor.useTemplate': 'Use Template',
  'templates.statuses.repair_status_columns': 'Repair status columns',
  'templates.statuses.unresolved_apply_guard': 'Status columns need repair ({{count}})',
  'templates.editor.templateBadge': 'Template',
  'templates.detail.usedCount': 'Used: {{count}} times',
  'projectList.columns.actions': 'Actions',
  'templates.editor.projectPhases': 'Project Phases',
  'templates.detail.projectPhases': 'Project Phases',
  'templates.editor.statusColumnsLabel': 'Status Columns',
  'templates.editor.clientPortalVisibility': 'Client Portal Visibility',
  'templates.editor.deleteTemplateTitle': 'Delete Template',
  'common:actions.back': 'Back',
  'common:actions.delete': 'Delete',
  'templates.list.deleteMessage': 'Are you sure you want to delete template "{{templateName}}"?',
};

function translate(key: string, arg2?: unknown): string {
  if (typeof arg2 === 'string') return arg2;
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  const template = DICT[key] ?? (typeof opts.defaultValue === 'string' ? opts.defaultValue : key);
  return template.replace(/{{\s*(\w+)\s*}}/g, (_m: string, name: string) => String(opts[name] ?? ''));
}

function makeTemplate(overrides: Partial<IProjectTemplateWithDetails> = {}): IProjectTemplateWithDetails {
  return {
    tenant: 'tpl-1',
    template_id: 'tpl-1',
    template_name: 'Repair Template',
    created_by: 'user-1',
    created_at: new Date(),
    use_count: 0,
    phases: [],
    tasks: [],
    dependencies: [],
    checklist_items: [],
    status_mappings: [],
    task_assignments: [],
    unresolved_status_mapping_count: 0,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('TemplateEditor unresolved status mapping guard', () => {
  beforeEach(() => {
    (globalThis as any).ResizeObserver = ResizeObserverStub;
    vi.clearAllMocks();
  });

  it('shows the Repair status columns guard instead of Use Template while unresolved_status_mapping_count > 0', async () => {
    const { container } = render(
      <TemplateEditor template={makeTemplate({ unresolved_status_mapping_count: 1 })} onTemplateUpdated={vi.fn()} />
    );

    await waitFor(() => expect(container.querySelector('#repair-status-columns')).not.toBeNull());
    expect(container.querySelector('#use-template')).toBeNull();
    expect(screen.getByText('Repair status columns')).toBeInTheDocument();
  });

  it('restores Use Template when the unresolved count drops to zero via a completed replacement', async () => {
    const { container } = render(
      <TemplateEditor template={makeTemplate({ unresolved_status_mapping_count: 1 })} onTemplateUpdated={vi.fn()} />
    );

    await waitFor(() => expect(container.querySelector('#repair-status-columns')).not.toBeNull());

    // Open the Status Manager (repair) and complete the replacement.
    fireEvent.click(container.querySelector('#repair-status-columns') as HTMLElement);
    const repairDone = await screen.findByTestId('mock-repair-done');
    fireEvent.click(repairDone);

    await waitFor(() => expect(container.querySelector('#use-template')).not.toBeNull());
    expect(container.querySelector('#repair-status-columns')).toBeNull();
    expect(screen.getByText('Use Template')).toBeInTheDocument();
  });

  it('shows Use Template directly when there are no unresolved mappings', async () => {
    const { container } = render(
      <TemplateEditor template={makeTemplate({ unresolved_status_mapping_count: 0 })} onTemplateUpdated={vi.fn()} />
    );

    await waitFor(() => expect(container.querySelector('#use-template')).not.toBeNull());
    expect(container.querySelector('#repair-status-columns')).toBeNull();
  });
});
