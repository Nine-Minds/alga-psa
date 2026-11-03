/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IProject } from '@alga-psa/types';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => {
    const nameColumn = columns.find((column: any) => column.dataIndex === 'project_name');
    return <div data-testid="projects-table">{data.map((record: IProject, index: number) => (
      <div key={record.project_id ?? index} data-testid="project-row">
        {nameColumn.render(record.project_name, record)}
      </div>
    ))}</div>;
  },
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components', () => ({ TagFilter: () => null }));
vi.mock('@alga-psa/ui/components/ClientNameCell', () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <>{children}</>,
  DropdownMenuItem: ({ children }: any) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/components/Drawer', () => ({ default: () => null }));
vi.mock('@alga-psa/ui', () => ({
  DeleteEntityDialog: () => null,
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
  useClientDrawer: () => vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ handleError: vi.fn(), isActionPermissionError: (value: any) => Boolean(value?.permissionError) }));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({ ShortcutActiveRegion: ({ children }: any) => <>{children}</>, usePageCreateShortcut: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useFormatters: () => ({ formatDate: () => 'date' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, options?: any) => options?.defaultValue ?? _key }) }));
vi.mock('@alga-psa/projects/actions/projectActions', () => ({ deleteProject: vi.fn(), loadProjectListItemsByIds: vi.fn(), searchProjectListIds: vi.fn().mockResolvedValue([]) }));
vi.mock('@alga-psa/user-composition/actions', () => ({ findUserById: vi.fn(), getAllUsersBasic: vi.fn().mockResolvedValue([]), getUserAvatarUrlsBatchAction: vi.fn() }));
vi.mock('@alga-psa/tags/actions', () => ({ findTagsByEntityIds: vi.fn().mockResolvedValue([]), findAllTagsByType: vi.fn().mockResolvedValue([]), isTagActionError: () => false }));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('@alga-psa/tags/hooks', () => ({ useTagPermissions: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/components/SmartSearchResults', () => ({}));
vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({ preCheckDeletion: vi.fn() }));
vi.mock('./ProjectQuickAdd', () => ({ default: () => null }));
vi.mock('./ProjectDetailsEdit', () => ({ default: () => null }));
vi.mock('./DeadlineFilter', () => ({ DeadlineFilter: () => null }));
vi.mock('./project-templates/ApplyTemplateDialog', () => ({ ApplyTemplateDialog: () => null }));
vi.mock('../context/ClientIntegrationContext', () => ({ useClientIntegration: () => ({
  getAllContacts: vi.fn().mockResolvedValue([]),
  getContactByContactNameId: vi.fn(),
  renderQuickAddContact: () => null,
  renderClientDetails: () => null,
}) }));
vi.mock('@alga-psa/list-views/hooks', () => ({ useListViews: () => ({}) }));
vi.mock('@alga-psa/list-views/components', () => ({ ListViewPicker: () => null }));
vi.mock('@enterprise/components/smartSearch/SmartSearchResults', () => ({ SmartSearchResults: () => null }));

import Projects from './Projects';

afterEach(cleanup);

describe('Projects consumer with redacted project records', () => {
  it('renders the wildcard-suppressed list as empty', () => {
    render(<Projects initialProjects={[]} clients={[]} />);
    expect(screen.getByTestId('projects-table').children).toHaveLength(0);
    expect(screen.queryByTestId('project-row')).toBeNull();
  });

  it('filters, sorts, and renders project_name-redacted rows without exposing a hidden name', () => {
    const projects = [
      { project_id: 'p2', project_number: 'PRJ-2', is_inactive: false } as IProject,
      { project_id: 'p1', project_name: 'Visible project', project_number: 'PRJ-1', is_inactive: false } as IProject,
    ];
    render(<Projects initialProjects={projects} clients={[]} />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Project name hidden', 'Visible project']);
    expect(links[0].getAttribute('href')).toBe('/msp/projects/p2');
    expect(document.body.textContent).not.toContain('Secret project name');
  });
});
