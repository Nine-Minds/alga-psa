/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedProjectTaskHistory from '../../../components/co-managed/CoManagedProjectTaskHistory';
import CoManagedProjectTaskAssignment from '../../../components/co-managed/CoManagedProjectTaskAssignment';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), statuses: vi.fn(), edit: vi.fn(), assign: vi.fn(), history: vi.fn() }));
vi.mock('../../../lib/actions/coManagedProjectTaskActions', () => ({
  getCoManagedProjectTaskSnapshotAction: mocks.snapshot, listCoManagedProjectTaskStatusOptionsAction: mocks.statuses,
  editCoManagedProjectTaskAction: mocks.edit, assignCoManagedProjectTaskAction: mocks.assign, listCoManagedProjectTaskHistoryAction: mocks.history }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, options, onValueChange }: any) =>
  <label>{label}<select id={id} aria-label={label} value={value} onChange={event => onValueChange(event.target.value)}>
    {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label> }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: ({ id, value }: any) => <span id={id}>{value ? value.toISOString() : 'no date'}</span> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, o?: any) => (o?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_m: string, k: string) => String(o?.[k] ?? '')) }),
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }) }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const snapshot = (revision = 3, name = 'Patch servers') => ({ revision, taskUpdatedAt: '2026-10-01T10:00:00.000Z',
  values: { task_name: name, project_status_mapping_id: 'm1', due_date: '2026-10-20T00:00:00.000Z' },
  assignee: { kind: 'user' as const, name: 'Quinn Tech' } });
const props = { customerTenant: 'c1', relationshipId: 'r1', taskId: 't1', userId: 'u1' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.snapshot.mockResolvedValue(snapshot());
  mocks.statuses.mockResolvedValue([{ statusMappingId: 'm1', name: 'To Do' }, { statusMappingId: 'm2', name: 'Done' }]);
  mocks.history.mockResolvedValue([]);
});
afterEach(cleanup);

describe('co-managed project task history', () => {
  it('renders the qualified author and readable changes without ids', async () => {
    mocks.history.mockResolvedValue([{ auditId: 'a1', at: '2026-10-02T10:00:00.000Z', operation: 'co_managed_project_task_update', authorName: 'Quinn Tech', organizationName: 'Emerald MSP',
      changes: { task_name: { from: 'A', to: 'B' }, project_status_mapping_id: { from: 'm1', to: 'm2' } } }]);
    render(<CoManagedProjectTaskHistory customerTenant="c1" relationshipId="r1" taskId="t1" statusNames={{ m1: 'To Do', m2: 'Done' }} />);
    await screen.findByText(/Quinn Tech \(Emerald MSP\)/);
    expect(screen.getByText('Name: A → B')).toBeTruthy();
    expect(screen.getByText('Status: To Do → Done')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\ba1\b|\bm2\b/);
  });
});

describe('co-managed project task assignment', () => {
  it('hides "Assign to me" when the task is already assigned to the viewer, and offers it otherwise', () => {
    const shared = { ...props, revision: 3, assigneeName: 'QA Tester', isAssigned: true };
    const mine = render(<CoManagedProjectTaskAssignment {...shared} assignedToMe />);
    expect(mine.container.textContent).toContain('Assigned to QA Tester');
    expect(mine.container.querySelector('#co-managed-task-assign-me')).toBeNull();
    mine.unmount();
    const other = render(<CoManagedProjectTaskAssignment {...shared} assignedToMe={false} />);
    expect(other.container.querySelector('#co-managed-task-assign-me')).not.toBeNull();
  });

  it('assigns with expectedRevision null first, then the new revision once a reference exists', async () => {
    mocks.assign.mockResolvedValue({ success: true, receipt: { referenceId: 'ref', revision: 1, assigneeName: 'Quinn Tech' } });
    const onChanged = vi.fn();
    const { rerender } = render(<CoManagedProjectTaskAssignment {...props} revision={null} onChanged={onChanged} />);
    fireEvent.click(document.getElementById('co-managed-task-assign-me')!);
    await screen.findByText('Assigned to Quinn Tech');
    expect(mocks.assign).toHaveBeenLastCalledWith('c1', 'r1', 't1', { operationId: expect.stringMatching(UUID), expectedRevision: null, assignee: { kind: 'user', id: 'u1' } });
    expect(onChanged).toHaveBeenCalledWith('Quinn Tech');
    rerender(<CoManagedProjectTaskAssignment {...props} revision={1} onChanged={onChanged} />);
    fireEvent.click(document.getElementById('co-managed-task-assign-me')!);
    await waitFor(() => expect(mocks.assign).toHaveBeenLastCalledWith('c1', 'r1', 't1', expect.objectContaining({ expectedRevision: 1 })));
  });

  it('reuses the operation id when the response was lost', async () => {
    mocks.assign.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ success: true, receipt: { referenceId: 'ref', revision: 1, assigneeName: 'Quinn Tech' } });
    render(<CoManagedProjectTaskAssignment {...props} revision={null} />);
    fireEvent.click(document.getElementById('co-managed-task-assign-me')!);
    await screen.findByText('This task could not be assigned.');
    fireEvent.click(document.getElementById('co-managed-task-assign-me')!);
    await screen.findByText('Assigned to Quinn Tech');
    expect(mocks.assign.mock.calls[0][3].operationId).toBe(mocks.assign.mock.calls[1][3].operationId);
  });
});
