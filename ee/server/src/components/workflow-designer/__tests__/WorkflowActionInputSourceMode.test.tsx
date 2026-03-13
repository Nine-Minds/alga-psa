/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  deriveWorkflowActionInputSourceMode,
  WorkflowActionInputSourceMode,
} from '../WorkflowActionInputSourceMode';

describe('WorkflowActionInputSourceMode', () => {
  it('T107-T110: renders explicit reference, fixed value, and advanced source modes', () => {
    const { rerender } = render(
      <WorkflowActionInputSourceMode
        idPrefix="field"
        value={{ $expr: 'payload.summary' }}
        onModeChange={vi.fn()}
        onAdvancedModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Reference')).toBeInTheDocument();

    rerender(
      <WorkflowActionInputSourceMode
        idPrefix="field"
        value="literal value"
        onModeChange={vi.fn()}
        onAdvancedModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Fixed value')).toBeInTheDocument();

    rerender(
      <WorkflowActionInputSourceMode
        idPrefix="field"
        value={{ $secret: 'API_TOKEN' }}
        onModeChange={vi.fn()}
        onAdvancedModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Secret')).toBeInTheDocument();
  });

  it('treats direct field references as reference mode and complex expressions as advanced expressions', () => {
    expect(deriveWorkflowActionInputSourceMode({ $expr: 'payload.summary' })).toEqual({
      mode: 'reference',
      advancedMode: 'expression',
    });
    expect(deriveWorkflowActionInputSourceMode({ $expr: 'payload.summary & "-" & meta.traceId' })).toEqual({
      mode: 'advanced',
      advancedMode: 'expression',
    });
  });
});
