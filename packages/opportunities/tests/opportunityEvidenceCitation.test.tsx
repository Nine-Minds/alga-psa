/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpportunityStepTimeline } from '../src/components/detail/OpportunityStepTimeline';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const baseProps = {
  entries: [], steps: [], stage: 'qualified', isOpen: true, templateCounts: {},
  onAddStep: vi.fn(), onApplyTemplate: vi.fn(), onCompleteStep: vi.fn(), onEditStep: vi.fn(), onDeleteStep: vi.fn(),
};

const citation = (overrides: Record<string, unknown>) => ({
  citation_id: 'c-1', type: 'document', id: 'doc-1', label: 'Scope.pdf', missing: false, ...overrides,
});

const declaration = (overrides: Record<string, unknown> = {}) => ({
  evidence_id: 'ev-1', note: 'Budget confirmed', recorded_at: '2026-10-01T00:00:00.000Z',
  citations: [citation({}), citation({ citation_id: 'c-2', type: 'interaction', id: 'int-1', label: 'Discovery call' })],
  ...overrides,
});

const ladder = (qualifiedDeclaration: any = declaration(), extra: any[] = []) => ([
  { checkpoint: 'identified', state: 'reached', evidence: null, declaration: null },
  { checkpoint: 'qualified', state: 'reached', evidence: { evidence_id: 'ev-1', source: 'user_declared' }, declaration: qualifiedDeclaration },
  { checkpoint: 'assessment', state: 'pending', evidence: null, declaration: null },
  ...extra,
]) as any;

const rung = (stage: string) => document.getElementById(`opportunity-stage-segment-${stage}`) as HTMLElement;

describe('rung declaration', () => {
  it('shows the note, a Source: line with every source as a link, and Edit evidence on the current stage whose circle is not a button', () => {
    const onOpenCitation = vi.fn();
    const onEditEvidence = vi.fn();
    render(<OpportunityStepTimeline {...baseProps} ladder={ladder()} onOpenCitation={onOpenCitation} canOpenInteraction onEditEvidence={onEditEvidence} />);
    const qualified = within(rung('qualified'));

    expect(qualified.getByText('Budget confirmed')).toBeInTheDocument();
    expect(qualified.getByText('Source:')).toBeInTheDocument();
    fireEvent.click(qualified.getByRole('button', { name: 'Scope.pdf' }));
    expect(onOpenCitation).toHaveBeenLastCalledWith('document', 'doc-1');
    fireEvent.click(qualified.getByRole('button', { name: 'Discovery call' }));
    expect(onOpenCitation).toHaveBeenLastCalledWith('interaction', 'int-1');
    fireEvent.click(qualified.getByRole('button', { name: 'Edit evidence' }));
    expect(onEditEvidence).toHaveBeenCalledWith('qualified');
    // The circle moves the deal, and is not a control on the stage the deal is already at.
    expect(document.getElementById('opportunity-stage-segment-qualified-dot')).toBeNull();
  });

  it('offers Add evidence on a reached rung with no declaration', () => {
    render(<OpportunityStepTimeline {...baseProps} ladder={ladder(null)} onEditEvidence={vi.fn()} />);
    const qualified = within(rung('qualified'));
    expect(qualified.getByRole('button', { name: 'Add evidence' })).toBeInTheDocument();
    expect(qualified.queryByText('Source:')).not.toBeInTheDocument();
  });

  it('renders no Edit evidence control on an unreached rung or Identified, nor without a host handler', () => {
    const { unmount } = render(<OpportunityStepTimeline {...baseProps} ladder={ladder()} onEditEvidence={vi.fn()} />);
    expect(within(rung('assessment')).queryByRole('button', { name: /evidence/i })).not.toBeInTheDocument();
    expect(within(rung('identified')).queryByRole('button', { name: /evidence/i })).not.toBeInTheDocument();
    unmount();

    render(<OpportunityStepTimeline {...baseProps} ladder={ladder()} />);
    expect(screen.queryByRole('button', { name: /evidence/i })).not.toBeInTheDocument();
  });

  it('keeps Edit evidence on a closed deal', () => {
    render(<OpportunityStepTimeline {...baseProps} isOpen={false} stage="won" ladder={ladder()} onEditEvidence={vi.fn()} />);
    expect(within(rung('qualified')).getByRole('button', { name: 'Edit evidence' })).toBeInTheDocument();
  });

  it('shows a source whose target is gone as a muted "Source removed" badge, not a link', () => {
    render(<OpportunityStepTimeline {...baseProps} ladder={ladder(declaration({
      citations: [citation({ missing: true, label: null }), citation({ citation_id: 'c-2', label: 'Still here' })],
    }))} onOpenCitation={vi.fn()} />);
    const qualified = within(rung('qualified'));
    expect(qualified.getByText('Source removed')).toBeInTheDocument();
    expect(qualified.getByRole('button', { name: 'Still here' })).toBeInTheDocument();
    expect(qualified.queryByRole('button', { name: 'Source removed' })).not.toBeInTheDocument();
  });

  it('renders an interaction as plain text when the host has no interaction opener, but keeps documents actionable', () => {
    render(<OpportunityStepTimeline {...baseProps} ladder={ladder()} onOpenCitation={vi.fn()} canOpenInteraction={false} />);
    const qualified = within(rung('qualified'));
    expect(qualified.getByText('Discovery call')).toBeInTheDocument();
    expect(qualified.queryByRole('button', { name: 'Discovery call' })).not.toBeInTheDocument();
    expect(qualified.getByRole('button', { name: 'Scope.pdf' })).toBeInTheDocument();
  });

  it('renders documents as text when the host cannot open citations at all', () => {
    render(<OpportunityStepTimeline {...baseProps} ladder={ladder()} />);
    expect(screen.getByText('Scope.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scope.pdf' })).not.toBeInTheDocument();
  });

  it('a later rung circle still moves the deal', () => {
    const onStageSelect = vi.fn();
    render(<OpportunityStepTimeline {...baseProps} ladder={ladder()} onStageSelect={onStageSelect} />);
    fireEvent.click(document.getElementById('opportunity-stage-segment-assessment-dot') as HTMLElement);
    expect(onStageSelect).toHaveBeenCalledWith('assessment');
  });
});
