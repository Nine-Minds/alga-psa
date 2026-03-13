/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultWorkflowActionInputLiteralValue,
  createWorkflowActionInputValueForMode,
  deriveWorkflowActionInputSourceMode,
  getDefaultWorkflowActionInputSourceMode,
  isWorkflowActionInputLegacyValue,
  transitionWorkflowActionInputMode,
  WorkflowActionInputSourceMode,
} from '../WorkflowActionInputSourceMode';

afterEach(() => {
  cleanup();
});

describe('WorkflowActionInputSourceMode', () => {
  it('T107-T110: renders explicit reference and fixed value source modes', () => {
    const { rerender } = render(
      <WorkflowActionInputSourceMode
        idPrefix="field"
        value={{ $expr: 'payload.summary' }}
        onModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Reference')).toBeInTheDocument();

    rerender(
      <WorkflowActionInputSourceMode
        idPrefix="field"
        value="literal value"
        onModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('Fixed value')).toBeInTheDocument();
  });

  it('T152/T153/T313: rehydrates direct field references into structured Reference mode and treats non-structured mappings as legacy', () => {
    expect(deriveWorkflowActionInputSourceMode({ $expr: '' })).toEqual({ mode: 'reference' });
    expect(deriveWorkflowActionInputSourceMode({ $expr: 'payload.summary' })).toEqual({ mode: 'reference' });
    expect(deriveWorkflowActionInputSourceMode({ $expr: 'ticketItem.id' })).toEqual({ mode: 'reference' });
    expect(deriveWorkflowActionInputSourceMode({ $expr: 'payload.summary & "-" & meta.traceId' })).toEqual({
      mode: 'fixed',
    });
    expect(isWorkflowActionInputLegacyValue({ $expr: 'payload.summary & "-" & meta.traceId' })).toBe(true);
    expect(isWorkflowActionInputLegacyValue({ $secret: 'API_TOKEN' })).toBe(true);
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

  it('T112/T113: creates reference and fixed values in the existing mapping contract', () => {
    const stringField = { type: 'string' } as const;

    expect(createWorkflowActionInputValueForMode(stringField, undefined, 'reference')).toEqual({
      $expr: '',
    });
    expect(createWorkflowActionInputValueForMode(
      { type: 'string', default: 'fallback' },
      undefined,
      'fixed'
    )).toBe('fallback');
  });

  it('builds fixed literal defaults for primitive and object-like fields', () => {
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'boolean' })).toBe(false);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'number' })).toBe(0);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'array' })).toEqual([]);
    expect(buildDefaultWorkflowActionInputLiteralValue({ type: 'object' })).toEqual({});
  });

  it('T134/T135: preserves fixed nested values and direct references when switching between fixed and reference modes', () => {
    const nestedLiteral = {
      requester: {
        name: 'Alex',
      },
    };
    const fixedToReference = transitionWorkflowActionInputMode(
      { type: 'object' },
      nestedLiteral,
      'reference'
    );

    expect(fixedToReference.nextValue).toEqual({ $expr: '' });
    expect(fixedToReference.preservedFixedValue).toEqual(nestedLiteral);

    const referenceBackToFixed = transitionWorkflowActionInputMode(
      { type: 'object' },
      fixedToReference.nextValue,
      'fixed',
      {
        preservedFixedValue: fixedToReference.preservedFixedValue,
      }
    );

    expect(referenceBackToFixed.nextValue).toEqual(nestedLiteral);

    const directReference = { $expr: 'payload.requester.name' } as const;
    const referenceToFixed = transitionWorkflowActionInputMode(
      { type: 'string' },
      directReference,
      'fixed'
    );

    expect(referenceToFixed.nextValue).toEqual('');
    expect(referenceToFixed.preservedReferenceValue).toEqual(directReference);
  });
});
