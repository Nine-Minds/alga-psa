/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  declareOpportunityStage: vi.fn(async () => ({})),
  amendOpportunityDeclaration: vi.fn(async () => ({})),
  listCitableSourcesForOpportunity: vi.fn(async () => [
    { type: 'document', id: 'doc-2', label: 'Transcript.txt', date: '2026-10-03T00:00:00.000Z' },
  ]),
  getOpportunity: vi.fn(async () => ({})),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('react-hot-toast', () => ({ toast }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: any, maybeOptions?: any) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : fallbackOrOptions?.defaultValue;
      const options = (typeof fallbackOrOptions === 'string' ? maybeOptions : fallbackOrOptions) ?? {};
      return String(fallback ?? _key).replace('{{stage}}', String(options.stage ?? ''));
    },
  }),
}));
vi.mock('@alga-psa/core', () => ({ formatCurrencyFromMinorUnits: () => '$0' }));
vi.mock('@alga-psa/projects/actions', () => ({ getProjectStatuses: vi.fn(async () => []), getTemplates: vi.fn(async () => []) }));
vi.mock('../src/actions/opportunityActions', () => ({
  ...actions,
  deleteOpportunity: vi.fn(), linkQuoteToOpportunity: vi.fn(), listLinkableQuotesForOpportunity: vi.fn(),
  loseOpportunity: vi.fn(), unlinkQuoteFromOpportunity: vi.fn(), updateOpportunity: vi.fn(), winOpportunity: vi.fn(),
}));
vi.mock('../src/actions/opportunityStepActions', () => ({
  assignOpportunityOwner: vi.fn(), listOpportunityAssignees: vi.fn(async () => []), updateOpportunityNextAction: vi.fn(),
}));

// The host's own job here is wiring: the plan panel just exposes the two handlers.
vi.mock('../src/components/detail/OpportunityDetailView', () => ({ OpportunityDetailView: ({ timeline }: any) => <div>{timeline}</div> }));
vi.mock('../src/components/detail/OpportunityPlanPanel', () => ({
  OpportunityPlanPanel: ({ onStageSelect, onEditEvidence }: any) => (
    <div>
      <button onClick={() => onStageSelect('assessment')}>move</button>
      <button onClick={() => onEditEvidence('verbal')}>edit</button>
    </div>
  ),
}));
vi.mock('../src/components/detail/OpportunityCitationDocument', () => ({ OpportunityCitationDocument: () => null }));
vi.mock('../src/components/dialogs/LoseOpportunityDialog', () => ({ LoseOpportunityDialog: () => null }));
vi.mock('../src/components/dialogs/EditValuesDialog', () => ({ EditValuesDialog: () => null }));
vi.mock('../src/components/dialogs/EditOpportunityDialog', () => ({ EditOpportunityDialog: () => null }));
vi.mock('../src/components/dialogs/DraftEditorDialog', () => ({ DraftEditorDialog: () => null }));
vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  default: ({ id, options, onChange }: any) => (
    <select data-testid={id} value="" onChange={(e) => onChange(e.target.value)}>
      <option value="">pick</option>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: ({ id, value, onChange, label }: any) => <textarea id={id} aria-label={label} value={value} onChange={onChange} /> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ isOpen, children, title }: any) => (isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null) }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, onClick, disabled, id, 'aria-label': al }: any) => <button id={id} aria-label={al} onClick={onClick} disabled={disabled}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/lib/dateInput', () => ({ dateFromString: () => undefined, dateToString: () => '' }));

import { OpportunityDetailHost } from '../src/components/detail/OpportunityDetailHost';

const detail: any = {
  opportunity_id: 'opp-1', title: 'Deal', status: 'open', stage: 'verbal', linked_quotes: [], updated_at: 'now',
  ladder: [
    { checkpoint: 'identified', state: 'reached', evidence: null, declaration: null },
    { checkpoint: 'verbal', state: 'reached', evidence: { evidence_id: 'ev-1' }, declaration: {
      evidence_id: 'ev-1', note: 'Verbal yes', recorded_at: '2026-10-01T00:00:00.000Z',
      citations: [{ citation_id: 'c-1', type: 'document', id: 'doc-1', label: 'Scope.pdf', missing: false }],
    } },
  ],
};

describe('OpportunityDetailHost declarations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saving the edit dialog calls the amend action with the reached stage, and never the declare action', async () => {
    render(<OpportunityDetailHost detail={detail} />);
    fireEvent.click(screen.getByText('edit'));
    expect(screen.getByRole('dialog', { name: 'Evidence for Verbal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Note')).toHaveValue('Verbal yes');
    await waitFor(() => expect(actions.listCitableSourcesForOpportunity).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Verbal yes, confirmed in writing' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(actions.amendOpportunityDeclaration).toHaveBeenCalledWith('opp-1', 'verbal', {
      note: 'Verbal yes, confirmed in writing',
      citations: [{ type: 'document', id: 'doc-1' }],
    }));
    expect(actions.declareOpportunityStage).not.toHaveBeenCalled();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('declaring from a rung circle passes the note and sources to the declare action', async () => {
    render(<OpportunityDetailHost detail={detail} />);
    fireEvent.click(screen.getByText('move'));
    expect(screen.getByRole('dialog', { name: 'Move to Assessment' })).toBeInTheDocument();
    await waitFor(() => expect(actions.listCitableSourcesForOpportunity).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Assessment done' } });
    await waitFor(() => expect(screen.getByTestId('opportunity-declare-source').querySelectorAll('option').length).toBe(2));
    fireEvent.change(screen.getByTestId('opportunity-declare-source'), { target: { value: 'document:doc-2' } });
    fireEvent.click(screen.getByText('Declare'));

    await waitFor(() => expect(actions.declareOpportunityStage).toHaveBeenCalledWith('opp-1', 'assessment', {
      note: 'Assessment done',
      citations: [{ type: 'document', id: 'doc-2' }],
    }));
    expect(actions.amendOpportunityDeclaration).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and toasts when the amend is refused', async () => {
    actions.amendOpportunityDeclaration.mockRejectedValueOnce(new Error('That source is not attached to this opportunity'));
    render(<OpportunityDetailHost detail={detail} />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That source is not attached to this opportunity'));
    expect(screen.getByRole('dialog', { name: 'Evidence for Verbal' })).toBeInTheDocument();
  });
});
