/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpportunityStepTimeline } from '../src/components/detail/OpportunityStepTimeline';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const baseProps = {
  entries: [], steps: [], stage: 'qualified', isOpen: false, templateCounts: {},
  onAddStep: vi.fn(), onApplyTemplate: vi.fn(), onCompleteStep: vi.fn(), onEditStep: vi.fn(), onDeleteStep: vi.fn(),
};

function renderCitation(
  type: 'interaction' | 'document',
  missing: boolean,
  onOpenCitation?: (type: 'interaction' | 'document', id: string) => void,
  canOpenInteraction?: boolean,
) {
  return render(<OpportunityStepTimeline
    {...baseProps}
    ladder={[{
      checkpoint: 'qualified', state: 'reached',
      evidence: { ref_type: type, ref_id: 'source-1', ref_label: 'Supporting source', ref_missing: missing },
    } as any]}
    onOpenCitation={onOpenCitation}
    canOpenInteraction={canOpenInteraction}
  />);
}

describe('opportunity evidence citations', () => {
  it('renders an interaction citation as plain text when no opener is available', () => {
    // The host always supplies a dispatcher; it only has a real interaction
    // opener when canOpenInteraction is true.
    renderCitation('interaction', false, vi.fn(), false);

    expect(screen.getByText('Supporting source')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supporting source' })).not.toBeInTheDocument();
  });

  it('keeps document citations actionable and removed sources non-actionable', () => {
    const openCitation = vi.fn();
    const { unmount } = renderCitation('document', false, openCitation);
    expect(screen.getByRole('button', { name: 'Supporting source' })).toBeInTheDocument();
    unmount();

    renderCitation('interaction', true);
    expect(screen.getByText('Source removed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supporting source' })).not.toBeInTheDocument();
  });

  it('renders a document citation as text when its opener is unavailable', () => {
    renderCitation('document', false);

    expect(screen.getByText('Supporting source')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supporting source' })).not.toBeInTheDocument();
  });
});
