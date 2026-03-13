/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultWorkflowActionInputLiteralValue,
  createWorkflowActionInputValueForMode,
  deriveWorkflowActionInputSourceMode,
  getDefaultWorkflowActionInputSourceMode,
  transitionWorkflowActionInputMode,
  WorkflowActionInputSourceMode,
} from '../WorkflowActionInputSourceMode';

afterEach(() => {
  cleanup();
});

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

  it('T152/T153/T313: rehydrates direct field references into structured Reference mode while reserving Advanced mode for expressions that cannot stay fully structured', () => {
    expect(deriveWorkflowActionInputSourceMode({ $expr: '' })).toEqual({
      mode: 'reference',
      advancedMode: 'expression',
    });
    expect(deriveWorkflowActionInputSourceMode({ $expr: 'payload.summary' })).toEqual({
      mode: 'reference',
      advancedMode: 'expression',
    });
    expect(deriveWorkflowActionInputSourceMode({ $expr: 'ticketItem.id' })).toEqual({
      mode: 'reference',
      advancedMode: 'expression',
    });
    expect(deriveWorkflowActionInputSourceMode({ $expr: 'payload.summary & "-" & meta.traceId' })).toEqual({
      mode: 'advanced',
      advancedMode: 'expression',
    });
  });

  it('T281/T282: keeps Advanced mode available for complex expressions and secret-backed values', () => {
    const { rerender } = render(
      <WorkflowActionInputSourceMode
        idPrefix="advanced-field"
        value={{ $expr: 'payload.summary & "-" & meta.traceId' }}
        onModeChange={vi.fn()}
        onAdvancedModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Expression')).toBeInTheDocument();

    rerender(
      <WorkflowActionInputSourceMode
        idPrefix="advanced-field"
        value={{ $secret: 'API_TOKEN' }}
        onModeChange={vi.fn()}
        onAdvancedModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Secret')).toBeInTheDocument();
  });

  it('T283: de-emphasizes Advanced mode with escape-hatch guidance in the source-mode UI', () => {
    render(
      <WorkflowActionInputSourceMode
        idPrefix="guided-field"
        value={{ $expr: 'payload.summary' }}
        onModeChange={vi.fn()}
        onAdvancedModeChange={vi.fn()}
      />
    );

    expect(
      screen.getByText('Use Advanced only for expressions or secrets.')
    ).toBeInTheDocument();
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

  it('T134/T135: preserves fixed nested values and direct references when switching into advanced mode', () => {
    const nestedLiteral = {
      requester: {
        name: 'Alex',
      },
    };
    const fixedToAdvanced = transitionWorkflowActionInputMode(
      { type: 'object' },
      nestedLiteral,
      'advanced',
      'expression'
    );

    expect(fixedToAdvanced.nextValue).toEqual({ $expr: '' });
    expect(fixedToAdvanced.preservedFixedValue).toEqual(nestedLiteral);

    const advancedBackToFixed = transitionWorkflowActionInputMode(
      { type: 'object' },
      fixedToAdvanced.nextValue,
      'fixed',
      'expression',
      {
        preservedFixedValue: fixedToAdvanced.preservedFixedValue,
      }
    );

    expect(advancedBackToFixed.nextValue).toEqual(nestedLiteral);

    const directReference = { $expr: 'payload.requester.name' } as const;
    const referenceToAdvanced = transitionWorkflowActionInputMode(
      { type: 'string' },
      directReference,
      'advanced',
      'expression'
    );

    expect(referenceToAdvanced.nextValue).toEqual(directReference);
    expect(referenceToAdvanced.preservedReferenceValue).toEqual(directReference);
  });
});
