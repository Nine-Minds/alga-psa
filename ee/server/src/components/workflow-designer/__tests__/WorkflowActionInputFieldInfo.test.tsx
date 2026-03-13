/** @vitest-environment jsdom */

import React from 'react';
import { render, within } from '@testing-library/react';
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
          constraints: {
            format: 'email',
            minLength: 5,
            maxLength: 120,
            pattern: '^[a-z]+$',
            itemType: 'string',
          },
          default: 'Default summary',
          examples: ['Escalate printer issue'],
        }}
        isMissingRequired
      />
    );

    const view = within(container);
    expect(view.getByText('summary')).toBeInTheDocument();
    expect(view.getByTitle('Required field is missing a value')).toBeInTheDocument();
    expect(view.getByText('Required')).toBeInTheDocument();
    expect(view.getByText('Ticket summary')).toBeInTheDocument();
    expect(view.getByText('Format: email')).toBeInTheDocument();
    expect(view.getByText('Each item: string')).toBeInTheDocument();
    expect(view.getByText('Length: 5 - 120')).toBeInTheDocument();
    expect(view.queryByText('Pattern: ^[a-z]+$')).not.toBeInTheDocument();
    expect(view.getByText('Default summary')).toBeInTheDocument();
    expect(view.getByText('Escalate printer issue')).toBeInTheDocument();

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
    expect(view.queryByText('Optional')).not.toBeInTheDocument();
    expect(view.getByText('Additional ticket details')).toBeInTheDocument();
  });
});
