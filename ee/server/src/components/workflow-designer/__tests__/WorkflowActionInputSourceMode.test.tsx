/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  buildDefaultWorkflowActionInputLiteralValue,
  createWorkflowActionInputValueForMode,
  deriveWorkflowActionInputSourceMode,
  getDefaultWorkflowActionInputSourceMode,
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

  it('T111: defaults new editable fields to structured source modes based on field type and metadata', () => {
    expect(getDefaultWorkflowActionInputSourceMode({ type: 'string' })).toBe('reference');
    expect(getDefaultWorkflowActionInputSourceMode({ type: 'number' })).toBe('fixed');
    expect(getDefaultWorkflowActionInputSourceMode({ enum: ['open', 'closed'] })).toBe('fixed');
    expect(getDefaultWorkflowActionInputSourceMode({
      type: 'string',
      picker: { allowsDynamicReference: false },
    })).toBe('fixed');
  });

  it('T112/T113/T114/T115: creates reference, fixed, advanced expression, and advanced secret values in the existing mapping contract', () => {
    const stringField = { type: 'string' } as const;

    expect(createWorkflowActionInputValueForMode(stringField, undefined, 'reference', 'expression')).toEqual({
      $expr: '',
    });
    expect(createWorkflowActionInputValueForMode(
      { type: 'string', default: 'fallback' },
      undefined,
      'fixed',
      'expression'
    )).toBe('fallback');
    expect(createWorkflowActionInputValueForMode(
      stringField,
      { $expr: 'payload.summary & "-" & meta.traceId' },
      'advanced',
      'expression'
    )).toEqual({
      $expr: 'payload.summary & "-" & meta.traceId',
    });
    expect(createWorkflowActionInputValueForMode(
      stringField,
      undefined,
      'advanced',
      'secret'
    )).toEqual({
      $secret: '',
    });
  });

  it('builds fixed literal defaults for primitive and object-like fields', () => {
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'boolean' })).toBe(false);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'number' })).toBe(0);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'array' })).toEqual([]);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'object' })).toEqual({});
  });
});
