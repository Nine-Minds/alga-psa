/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkflowActionInputFieldInfo } from '../WorkflowActionInputFieldInfo';

describe('WorkflowActionInputFieldInfo', () => {
  it('T101-T104/T116/T118: renders inline field labels with missing-required and description affordances', () => {
    const { rerender, container } = render(
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

    const view = within(container);
    expect(view.getByText('summary')).toBeInTheDocument();
    expect(view.getAllByTitle('Required field is missing a value')).toHaveLength(2);
    expect(view.getByText('Missing')).toBeInTheDocument();
    expect(view.getByText('Ticket summary')).toBeInTheDocument();

    rerender(
      <WorkflowActionInputFieldInfo
        field={{
          name: 'details',
          type: 'string',
          description: 'Additional ticket details',
        }}
      />
    );

    expect(view.getByText('details')).toBeInTheDocument();
    expect(view.getByText('Optional')).toBeInTheDocument();
    expect(view.getByText('Additional ticket details')).toBeInTheDocument();
  });
});
