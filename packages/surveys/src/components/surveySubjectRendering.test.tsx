// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SurveyResponseListItem } from '@alga-psa/types';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options: Record<string, string>) =>
    options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, name) => options[name] ?? '') }),
  useFormatters: () => ({ formatDate: (date: string) => date }),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, isOpen }: any) => isOpen ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
import SurveyPrintReport from './SurveyPrintReport';
import ResponsesList from './dashboard/ResponsesList';
import TopIssuesPanel from './dashboard/TopIssuesPanel';
import ResponseDetailModal from './responses/ResponseDetailModal';

afterEach(cleanup);
const base = { responseId: 'response', clientName: 'Client', contactName: 'Contact', rating: 1, comment: 'Please follow up', submittedAt: '2026-09-07T12:00:00Z', technicianName: 'Agent' };
describe.each(['ticket', 'project'] as const)('%s response presentation', kind => {
  const response: SurveyResponseListItem = { ...base, ticketId: kind === 'ticket' ? 'ticket-id' : null, ticketNumber: kind === 'ticket' ? 'T-123' : null,
    projectId: kind === 'project' ? 'project-id' : null, projectNumber: kind === 'project' ? 'P-123' : null };
  const number = kind === 'project' ? 'P-123' : 'T-123';
  it('links the recent response to its actual subject', () => {
    render(<ResponsesList responses={[response]} />);
    expect(screen.getByRole('link', { name: number })).toHaveAttribute('href', `/msp/${kind}s/${kind}-id`);
  });
  it('labels negative feedback with the correct subject', () => {
    render(<TopIssuesPanel issues={[{ ...response, assignedAgentName: 'Agent' }]} />);
    expect(screen.getByText(`${kind === 'project' ? 'Project' : 'Ticket'} ${number}`)).toBeInTheDocument();
  });
  it('includes the subject in both printed response sections', () => {
    render(<SurveyPrintReport title="Survey report" sections={['topIssues', 'recentResponses']} data={{
      metrics: { totalInvitations: 1, totalResponses: 1, responseRate: 100, averageRating: 1, outstandingInvitations: 0, recentNegativeResponses: 1 },
      trend: [], distribution: [], topIssues: [{ ...response, assignedAgentName: 'Agent' }], recentResponses: [response],
    }} />);
    expect(screen.getAllByText(number)).toHaveLength(2);
  });
  it('shows the subject in response details', () => {
    render(<ResponseDetailModal response={response} isOpen onClose={() => {}} />);
    expect(screen.getByText(kind === 'project' ? 'Project' : 'Ticket')).toBeInTheDocument();
    expect(screen.getByText(number)).toBeInTheDocument();
  });
});
