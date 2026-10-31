/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * The real shared project screen, both routes, with only server actions and data loaders mocked. Nothing in the
 * provider stack (documents, ticket/client integration, drawer, tags, product) is mocked: this is the test that
 * would have caught "useDocumentsCrossFeature must be used within a DocumentsCrossFeatureProvider".
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  nativeCalls: [] as string[],
  tagCalls: [] as { name: string; args: unknown[] }[],
  search: '' as string,
  redirected: null as string | null,
  toasts: [] as string[],
  edit: null as null | ((...a: any[]) => Promise<any>),
  read: null as any,
  // Tag actions: recorded with their arguments so a customer id reaching them is visible.
  tagActions: (): object => {
    const own: Record<string, unknown> = {
      isTagActionError: () => false,
      checkTagPermissions: async () => ({ canAddExisting: false, canCreateNew: false, canEditColors: false, canEditText: false, canDelete: false, canDeleteAll: false }),
    };
    return new Proxy(own, { has: () => true, get: (t, k) => k in t ? t[k as string] : k === 'then' || k === '__esModule' ? undefined
      : (...args: unknown[]) => { h.tagCalls.push({ name: String(k), args }); return Promise.resolve([]); } });
  },
  // A native action module that records every call. `has` is always true so named imports resolve.
  trap: (label: string): object => new Proxy({}, {
    has: () => true,
    get: (_t, k) => (k === 'then' || k === '__esModule' ? undefined : (...a: unknown[]) => { h.nativeCalls.push(`${label}.${String(k)}`); return Promise.resolve(undefined); }),
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (to: string) => { h.redirected = to; throw new Error('NEXT_REDIRECT'); },
  useSearchParams: () => new URLSearchParams(h.search),
  usePathname: () => '/msp/co-management/projects/c/r/p1',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1', tenant: 't1' } }, status: 'authenticated' }) }));
vi.mock('@alga-psa/auth', () => {
  const own: Record<string, unknown> = { getSession: async () => ({ user: { tenant: 't1', id: 'u1' } }), withAuth: (fn: unknown) => fn };
  return new Proxy(own, { has: () => true, get: (t, k) => (k in t ? t[k as string] : k === 'then' || k === '__esModule' ? undefined : async () => undefined) });
});
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForPage: async () => undefined }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: async () => ({ t: (k: string, o?: any) => o?.defaultValue ?? k }) }));
vi.mock('@/components/co-managed/CoManagedFeatureBoundary', () => ({ CoManagedFeatureBoundary: ({ children }: any) => <>{children}</> }));
vi.mock('@/lib/actions/coManagedProjectTaskActions', () => ({
  locateCoManagedSharedTaskAction: async () => ({ projectId: 'p1' }),
  getCoManagedSharedProjectScreenAction: async () => h.read,
  getCoManagedProjectTaskSnapshotAction: async () => null,
  editCoManagedProjectTaskAction: (...a: any[]) => h.edit!(...a),
  assignCoManagedProjectTaskAction: async () => ({ success: true }),
  listCoManagedProjectTaskHistoryAction: async () => [],
  listCoManagedProjectTaskStatusOptionsAction: async () => [],
}));

// Radix Tooltip around a Popover trigger loops on compose-refs under jsdom (the column picker); the tooltip is presentation only.
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: any) => <>{children}</>, TooltipProvider: ({ children }: any) => <>{children}</> }));
// Radix Select's trigger loops on compose-refs under jsdom; every other suite that renders it stubs it the same way.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options = [], value, onValueChange, placeholder, disabled }: any) => (
    <select id={id} aria-label={placeholder ?? id} disabled={disabled} value={value ?? ''} onChange={e => onValueChange?.(e.target.value)}>
      <option value="">{placeholder ?? ''}</option>
      {options.map((o: any) => <option key={String(o.value)} value={o.value}>{typeof o.label === 'string' ? o.label : String(o.value)}</option>)}
    </select>),
}));
vi.mock('react-hot-toast', () => {
  const record = (m: unknown) => { h.toasts.push(typeof m === 'string' ? m : '[node]'); return 'toast-id'; };
  const toast = Object.assign((m: unknown) => record(m), { success: record, error: (m: unknown) => record(`error: ${String(m)}`), dismiss: () => undefined, loading: record });
  return { default: toast, toast, Toaster: () => null };
});
vi.mock('@alga-psa/tags/actions', () => h.tagActions());
vi.mock('@alga-psa/tags/actions/tagActions', () => h.tagActions());

// Native project actions: any call with a customer's id is a failure.
vi.mock('@alga-psa/projects/actions/projectActions', () => h.trap('projectActions'));
vi.mock('@alga-psa/projects/actions/projectTaskActions', () => h.trap('projectTaskActions'));
vi.mock('@alga-psa/projects/actions/projectTaskCommentActions', () => h.trap('projectTaskCommentActions'));
vi.mock('@alga-psa/projects/actions/projectTaskStatusActions', () => h.trap('projectTaskStatusActions'));

import TaskPage from '@/app/msp/co-management/tasks/[customerTenant]/[relationshipId]/[taskId]/page';
import { ProductProvider } from '@/context/ProductContext';
import { DrawerProvider } from '@alga-psa/ui';
import { TagProvider } from '@alga-psa/tags/context';
import ProjectRoute from '@/app/msp/co-management/projects/[customerTenant]/[relationshipId]/[projectId]/page';

/** What DefaultLayout mounts above every MSP page. WorkspaceProviders is deliberately absent: it is the viewer-tenant stack. */
const Shell = ({ children }: { children: React.ReactNode }) => <ProductProvider productCode="psa"><TagProvider><DrawerProvider>{children}</DrawerProvider></TagProvider></ProductProvider>;

class Boundary extends React.Component<{ children: React.ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e: Error, info: { componentStack?: string }) { console.log('BOUNDARY', e.message, info.componentStack?.split('\n').slice(0, 14).join('\n')); }
  render() { return this.state.err ? <p>boundary</p> : this.props.children; }
}

const TASK_ID = 'task-1';
const readModel = (name = 'Patch servers') => ({
  project: { projectId: 'p1', projectName: 'Rollout', statusName: 'Active', isClosed: false, startDate: null, endDate: null, organizationName: 'Acme' },
  canCollaborate: true,
  phases: [{ phaseId: 'ph1', projectId: 'p1', phaseName: 'Phase 1', wbsCode: '1', orderKey: 'a' }],
  statuses: [
    { statusMappingId: 'm1', phaseId: null, name: 'To Do', customName: null, displayOrder: 1, isVisible: true, isClosed: false, color: null, icon: null },
    { statusMappingId: 'm2', phaseId: null, name: 'In Progress', customName: null, displayOrder: 2, isVisible: true, isClosed: false, color: null, icon: null },
  ],
  statusesByPhase: {},
  tasks: [{ taskId: TASK_ID, taskName: name, phaseId: 'ph1', statusMappingId: 'm1', dueDate: null, wbsCode: '1.1', orderKey: 'a',
    taskUpdatedAt: '2026-10-01T10:00:00.000Z', reference: { revision: 1, assigneeName: 'QA Tester', assignedToMe: false } }],
  redactedFields: [], hiddenTaskFields: [],
});

beforeEach(() => { h.nativeCalls = []; h.tagCalls = []; h.search = ''; h.redirected = null; h.toasts = []; h.read = readModel(); });

const renderRoute = async () => {
  const element = await ProjectRoute({ params: Promise.resolve({ customerTenant: 'c', relationshipId: 'r', projectId: 'p1' }) });
  return render(<Shell><Boundary>{element as React.ReactElement}</Boundary></Shell>);
};
const CUSTOMER_IDS = ['p1', TASK_ID, 'ph1', 'm1', 'm2'];
const noCustomerIdReachedTags = () => h.tagCalls.filter(c => JSON.stringify(c.args).match(new RegExp(CUSTOMER_IDS.map(id => `"${id}"`).join('|'))));

describe('shared project screen renders through the real provider stack', () => {
  it('project route: board renders, with no native action and no tag lookup for a customer id', async () => {
    await renderRoute();
    expect((await screen.findAllByText('Patch servers', {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('To Do')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('In Progress')).length).toBeGreaterThan(0);
    expect(h.nativeCalls).toEqual([]);
    expect(noCustomerIdReachedTags()).toEqual([]);
  });

  it('project route: list view renders the task', async () => {
    h.search = 'view=list';
    await renderRoute();
    expect((await screen.findAllByText('Patch servers', {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    expect(h.nativeCalls).toEqual([]);
  });

  it('task route: redirects to the project route, whose screen renders the drawer for that task', async () => {
    await expect(TaskPage({ params: Promise.resolve({ customerTenant: 'c', relationshipId: 'r', taskId: TASK_ID }) })).rejects.toThrow('NEXT_REDIRECT');
    expect(h.redirected).toBe(`/msp/co-management/projects/c/r/p1?taskId=${TASK_ID}`);
    h.search = new URL(h.redirected!, 'http://x').search;
    await renderRoute();
    expect(await screen.findByRole('dialog', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Patch servers')).toBeInTheDocument();
    expect(document.getElementById('co-managed-task-aside')).not.toBeNull();
    expect(h.nativeCalls).toEqual([]);
    expect(noCustomerIdReachedTags()).toEqual([]);
  });

  it('an admitted edit from the drawer reports success, shows the new name, and reaches no native action', async () => {
    h.search = `taskId=${TASK_ID}`;
    h.edit = vi.fn(async () => ({ success: true, receipt: { revision: 2, taskUpdatedAt: '2026-10-02T10:00:00.000Z' } }));
    await renderRoute();
    const input = await screen.findByDisplayValue('Patch servers', {}, { timeout: 8000 });
    fireEvent.change(input, { target: { value: 'Patch all servers' } });
    fireEvent.click(document.getElementById('task-form-submit') ?? screen.getByRole('button', { name: /update|save/i }));
    await waitFor(() => expect(h.edit).toHaveBeenCalledTimes(1));
    expect(h.edit).toHaveBeenCalledWith('c', 'r', TASK_ID, expect.objectContaining({
      expectedRevision: 1, expectedTaskUpdatedAt: '2026-10-01T10:00:00.000Z', patch: { task_name: 'Patch all servers' },
    }));
    await waitFor(() => expect(h.toasts).toContain('Task updated successfully!'));
    expect(h.toasts.some(m => /failed/i.test(m))).toBe(false);
    expect((await screen.findAllByText('Patch all servers')).length).toBeGreaterThan(0);
    expect(h.nativeCalls).toEqual([]);
    expect(noCustomerIdReachedTags()).toEqual([]);
  });
});
