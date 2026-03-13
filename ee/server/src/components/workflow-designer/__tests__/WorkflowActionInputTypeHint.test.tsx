/** @vitest-environment jsdom */

import React from 'react';
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  getWorkflowActionInputTypeHint,
  WorkflowActionInputTypeHint,
} from '../WorkflowActionInputTypeHint';

describe('WorkflowActionInputTypeHint', () => {
  it('T117: renders inline incompatibility and coercion messaging for reference selections', () => {
    const view = render(
      <WorkflowActionInputTypeHint
        sourceType="object"
        targetType="string"
      />
    );

    expect(
      within(view.container).getByText('Type "object" is incompatible with expected "string"')
    ).toBeInTheDocument();

    view.rerender(
      <WorkflowActionInputTypeHint
        sourceType="number"
        targetType="string"
      />
    );

    expect(
      within(view.container).getByText('Type "number" will be converted to "string"')
    ).toBeInTheDocument();
  });

  it('returns null when no warning should be shown', () => {
    expect(getWorkflowActionInputTypeHint('string', 'string')).toBeNull();
    expect(getWorkflowActionInputTypeHint(undefined, 'string')).toBeNull();
  });
});
