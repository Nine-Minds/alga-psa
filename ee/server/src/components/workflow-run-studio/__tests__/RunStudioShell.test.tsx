// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/workflows');
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUserPermissions: vi.fn(async () => []),
}));

vi.mock('@alga-psa/workflows/hooks/useWorkflowEnumOptions', () => ({
  useFormatWorkflowRunStatus: () => (status: string) => status,
}));

vi.mock('@alga-psa/workflows/actions', () => ({
  getWorkflowRunAction: vi.fn(async () => ({ run_id: 'run-123456789', workflow_id: 'wf/1', workflow_version: 2, status: 'FAILED' })),
  listWorkflowRunStepsAction: vi.fn(async () => ({ steps: [] })),
  listWorkflowRunsAction: vi.fn(async () => ({ runs: [{ workflow_name: 'Ticket triage' }] })),
  getWorkflowDefinitionVersionAction: vi.fn(async () => ({ definition_json: { steps: [] } })),
  listWorkflowRegistryActionsAction: vi.fn(async () => []),
}));

vi.mock('../../workflow-graph/WorkflowGraph', () => ({ default: () => <div /> }));
vi.mock('../WorkflowRunDetailsPanel', () => ({ default: () => <div /> }));

import RunStudioShell from '../RunStudioShell';

describe('RunStudioShell navigation', () => {
  it('shows a Workflows › Runs › run breadcrumb and links back to the workflow', async () => {
    render(<RunStudioShell runId="run-123456789" />);

    const back = await waitFor(() => {
      const link = document.getElementById('workflow-run-studio-back-to-workflow');
      expect(link).not.toBeNull();
      return link!;
    });
    expect(back).toHaveAttribute('href', '/msp/workflow-editor/wf%2F1');
    expect(back).toHaveTextContent('Back to workflow');

    const breadcrumb = document.getElementById('workflow-run-studio-breadcrumb')!;
    expect(document.getElementById('workflow-run-studio-breadcrumb-workflows')).toHaveAttribute('href', '/msp/workflow-editor');
    expect(document.getElementById('workflow-run-studio-breadcrumb-runs')).toHaveAttribute('href', '/msp/workflow-control?section=runs');
    await waitFor(() => expect(breadcrumb).toHaveTextContent('Ticket triage run'));
    expect(screen.queryByText(/Control Panel/)).not.toBeInTheDocument();
  });
});
