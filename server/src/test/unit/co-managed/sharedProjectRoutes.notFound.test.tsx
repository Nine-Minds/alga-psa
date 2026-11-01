/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tenant: 't1' as string | undefined, located: null as null | { projectId: string }, screenRead: null as unknown,
  redirected: null as string | null, nativeCalls: [] as string[],
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (to: string) => { state.redirected = to; throw new Error('NEXT_REDIRECT'); },
}));
vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@alga-psa/auth', () => ({ getSession: async () => ({ user: { tenant: state.tenant, id: 'u1' } }) }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForPage: async () => undefined }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: async () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? k }) }));
vi.mock('@/lib/actions/coManagedProjectTaskActions', () => ({
  locateCoManagedSharedTaskAction: async () => state.located,
  getCoManagedSharedProjectScreenAction: async () => state.screenRead,
  getCoManagedProjectTaskSnapshotAction: async () => null,
  editCoManagedProjectTaskAction: async () => ({ success: false, error: 'NOT_FOUND' }),
}));
// Any native project entry reached from the shared route is a failure.
vi.mock('@alga-psa/projects/actions/projectActions', () => new Proxy({}, { get: (_t, k) => k === 'then' || k === '__esModule' ? undefined : () => { state.nativeCalls.push(String(k)); } }));
vi.mock('@alga-psa/projects/components/ProjectPage', () => ({ default: () => <div id="native-project-page" /> }));
vi.mock('@/components/co-managed/CoManagedFeatureBoundary', () => ({ CoManagedFeatureBoundary: ({ children }: any) => <>{children}</> }));

import TaskPage, { generateMetadata as taskMetadata } from '@/app/msp/co-management/tasks/[customerTenant]/[relationshipId]/[taskId]/page';
import ProjectPage, { generateMetadata as projectMetadata } from '@/app/msp/co-management/projects/[customerTenant]/[relationshipId]/[projectId]/page';
import CoManagedSharedProject from '@/components/co-managed/CoManagedSharedProject';

const taskParams = Promise.resolve({ customerTenant: 'c', relationshipId: 'r', taskId: 'tk' });
const projectParams = Promise.resolve({ customerTenant: 'c', relationshipId: 'r', projectId: 'p' });

beforeEach(() => { state.tenant = 't1'; state.located = null; state.screenRead = null; state.redirected = null; state.nativeCalls = []; });

describe('co-managed shared project and task routes: authorized read returns null', () => {
  it('task page: not found when the task cannot be located, and no redirect', async () => {
    await expect(TaskPage({ params: taskParams })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.redirected).toBeNull();
  });

  it('task page: a located task redirects to the project route with the task id', async () => {
    state.located = { projectId: 'p 1' };
    await expect(TaskPage({ params: taskParams })).rejects.toThrow('NEXT_REDIRECT');
    expect(state.redirected).toBe('/msp/co-management/projects/c/r/p%201?taskId=tk');
  });

  it('both pages are not found without a session tenant', async () => {
    state.tenant = undefined;
    await expect(TaskPage({ params: taskParams })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(ProjectPage({ params: projectParams })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('project screen: a null shared read renders the not-available state, never the native page', async () => {
    render(<CoManagedSharedProject customerTenant="c" relationshipId="r" projectId="p" userId="u1" />);
    expect(await screen.findByText(/not available/i)).toBeInTheDocument();
    expect(document.getElementById('co-managed-shared-project-missing')).not.toBeNull();
    expect(document.getElementById('native-project-page')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/msp/co-management/tasks');
  });

  it('metadata is static: no native getProject/RSC project action is touched for a customer project id', async () => {
    await taskMetadata();
    const meta = await projectMetadata();
    expect(meta.title).toBe('Shared Project');
    expect(state.nativeCalls).toEqual([]);
    expect(projectMetadata.length).toBe(0);
  });
});
