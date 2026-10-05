// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { listWorkflowAuditLogsActionMock } = vi.hoisted(() => ({
  listWorkflowAuditLogsActionMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  const mock = await createLocaleTranslationMock('msp/workflows');
  return {
    ...mock,
    useFormatters: () => ({ formatDate: (date: Date) => date.toISOString() }),
  };
});

vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/workflows/actions', () => ({
  listWorkflowAuditLogsAction: (...args: unknown[]) => listWorkflowAuditLogsActionMock(...args),
  exportWorkflowAuditLogsAction: vi.fn(),
}));

import WorkflowDesignerAuditPanel from '../WorkflowDesignerAuditPanel';

describe('WorkflowDesignerAuditPanel', () => {
  it('names the acting user instead of showing their id', async () => {
    listWorkflowAuditLogsActionMock.mockResolvedValue({
      logs: [
        { audit_id: 'a1', timestamp: '2026-09-01T10:00:00.000Z', operation: 'workflow_definition_publish', user_id: 'u-1', user_name: 'Ada Lovelace' },
        { audit_id: 'a2', timestamp: '2026-09-01T09:00:00.000Z', operation: 'workflow_definition_update', user_id: 'u-gone', user_name: null },
        { audit_id: 'a3', timestamp: '2026-09-01T08:00:00.000Z', operation: 'workflow_definition_create', user_id: null },
      ],
      nextCursor: null,
    });

    render(<WorkflowDesignerAuditPanel workflowId="wf-1" workflowName="Flow" canAdmin />);

    expect(await screen.findByText('By Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('By Unknown user')).toHaveAttribute('title', 'u-gone');
    expect(screen.getByText('By system')).toBeInTheDocument();
    expect(screen.queryByText('u-1')).not.toBeInTheDocument();
    // Stacked entries, not a wide table that scrolls sideways in the narrow panel.
    expect(document.querySelector('table')).toBeNull();
  });
});
