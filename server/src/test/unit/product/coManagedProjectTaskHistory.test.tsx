/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CoManagedProjectTaskHistory from '../../../components/co-managed/CoManagedProjectTaskHistory';

const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock('@/lib/actions/coManagedProjectTaskActions', () => ({ listCoManagedProjectTaskHistoryAction: mocks.history }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ formatDate: () => 'Jan 1' }),
  useTranslation: () => ({ t: (key: string, o?: any) => (o?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_m: string, k: string) => String(o?.[k] ?? '')) }) }));

afterEach(cleanup);

describe('co-managed task history', () => {
  it('names the assignee from the id-free {kind, name} payload', async () => {
    mocks.history.mockResolvedValue([{ auditId: 'a1', at: '2026-01-01T00:00:00Z', operation: 'co_managed_project_task_assignment', authorName: 'Quinn', organizationName: 'Oz',
      changes: { msp_assignee: { kind: 'user', name: 'X' } } }]);
    render(<CoManagedProjectTaskHistory customerTenant="t" relationshipId="r" taskId="k" />);
    expect(await screen.findByText('Assignee set to X')).toBeTruthy();
  });
});
