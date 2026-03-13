/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkflowActionInputFieldInfo } from '../WorkflowActionInputFieldInfo';

describe('WorkflowActionInputFieldInfo', () => {
  it('T101-T104: renders inline action-field labels with required, optional, and description affordances', () => {
    const { rerender } = render(
      <WorkflowActionInputFieldInfo
        field={{
          name: 'summary',
          type: 'string',
          required: true,
          description: 'Ticket summary',
        }}
        isMissingRequired
      />
    );

    expect(screen.getByText('summary')).toBeInTheDocument();
    expect(screen.getByTitle('Required field is missing a value')).toBeInTheDocument();
    expect(screen.getByText('Ticket summary')).toBeInTheDocument();

    rerender(
      <WorkflowActionInputFieldInfo
        field={{
          name: 'details',
          type: 'string',
          description: 'Additional ticket details',
        }}
      />
    );

    expect(screen.getByText('details')).toBeInTheDocument();
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.getByText('Additional ticket details')).toBeInTheDocument();
  });
});
