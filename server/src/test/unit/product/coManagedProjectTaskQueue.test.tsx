/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedProjectTaskQueue from '../../../components/co-managed/CoManagedProjectTaskQueue';
import CoManagedProjectTaskQueueLink from '../../../components/co-managed/CoManagedProjectTaskQueueLink';

const mocks = vi.hoisted(() => ({ tasks: vi.fn(), projects: vi.fn(), capability: vi.fn() }));
vi.mock('../../../lib/actions/coManagedProjectTaskActions', () => ({ listCoManagedAssignedTasksAction: mocks.tasks, listCoManagedSharedProjectsAction: mocks.projects }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: mocks.capability }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, options, onValueChange }: any) =>
  <label>{label}<select id={id} aria-label={label} value={value} onChange={event => onValueChange(event.target.value)}>
    {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label> }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: ({ data, columns }: any) => <table><tbody>{data.map((row: any, i: number) =>
  <tr key={i}>{columns.map((c: any, j: number) => <td key={j}>{c.render ? c.render(row[c.dataIndex], row, i) : row[c.dataIndex]}</td>)}</tr>)}</tbody></table> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, o?: any) => (o?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_m: string, k: string) => String(o?.[k] ?? '')) }) }));

const task = { customerTenant: 'cust-tenant-1', relationshipId: 'rel-1', taskId: 'task-1', taskName: 'Patch servers', projectName: 'Server Refresh',
  organizationName: 'Kansas Dental', assigneeName: 'Quinn Tech', assignedToMe: true, revision: 2 };
const project = { customerTenant: 'cust-tenant-1', relationshipId: 'rel-1', projectId: 'proj-1', projectName: 'Server Refresh', organizationName: 'Kansas Dental', canCollaborate: true };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tasks.mockResolvedValue({ rows: [task], next: null });
  mocks.projects.mockResolvedValue({ rows: [project], next: null });
});
afterEach(cleanup);

describe('co-managed shared tasks queue', () => {
  it('renders names, links to the task and project routes, and never prints an id', async () => {
    render(<CoManagedProjectTaskQueue />);
    const link = await screen.findByText('Patch servers');
    expect(link.closest('a')!.getAttribute('href')).toBe('/msp/co-management/tasks/cust-tenant-1/rel-1/task-1');
    expect(screen.getAllByText('Kansas Dental').length).toBeGreaterThan(0);
    expect(screen.getByText('Quinn Tech (you)')).toBeTruthy();
    expect((await screen.findAllByText('Server Refresh'))[1].closest('a')!.getAttribute('href')).toBe('/msp/co-management/projects/cust-tenant-1/rel-1/proj-1');
    expect(document.body.textContent).not.toMatch(/task-1|proj-1|rel-1|cust-tenant-1/);
  });

  it('re-queries with the chosen assignment filter', async () => {
    render(<CoManagedProjectTaskQueue />);
    await screen.findByText('Patch servers');
    expect(mocks.tasks).toHaveBeenLastCalledWith({ assigned: 'me', limit: 25 });
    fireEvent.change(document.getElementById('co-managed-shared-tasks-filter')!, { target: { value: 'my_teams' } });
    await waitFor(() => expect(mocks.tasks).toHaveBeenLastCalledWith({ assigned: 'my_teams', limit: 25 }));
    fireEvent.change(document.getElementById('co-managed-shared-tasks-filter')!, { target: { value: 'any' } });
    await waitFor(() => expect(mocks.tasks).toHaveBeenLastCalledWith({ assigned: 'any', limit: 25 }));
  });

  it('pages with the returned cursor', async () => {
    mocks.tasks.mockResolvedValueOnce({ rows: [task], next: { referenceId: 'ref-9' } }).mockResolvedValueOnce({ rows: [{ ...task, taskId: 'task-2', taskName: 'Second task' }], next: null });
    render(<CoManagedProjectTaskQueue />);
    fireEvent.click(await screen.findByText('Load more'));
    await screen.findByText('Second task');
    expect(mocks.tasks).toHaveBeenLastCalledWith({ assigned: 'me', limit: 25, after: { referenceId: 'ref-9' } });
    expect(screen.getByText('Patch servers')).toBeTruthy();
  });
});

describe('co-managed shared tasks link', () => {
  it('renders only when the capability is served', () => {
    mocks.capability.mockReturnValue({ enabled: true, admitted: false, resolved: true });
    const { unmount } = render(<CoManagedProjectTaskQueueLink />);
    expect(document.getElementById('co-managed-shared-tasks-link')!.querySelector('a')?.getAttribute('href') ?? document.getElementById('co-managed-shared-tasks-link')!.getAttribute('href')).toBe('/msp/co-management/tasks');
    unmount();
    mocks.capability.mockReturnValue({ enabled: false, admitted: false, resolved: true });
    render(<CoManagedProjectTaskQueueLink />);
    expect(document.getElementById('co-managed-shared-tasks-link')).toBeNull();
  });
});
