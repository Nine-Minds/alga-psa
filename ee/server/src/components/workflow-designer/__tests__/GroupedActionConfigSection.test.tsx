/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupedActionConfigSection, buildGroupedActionSelectOptions } from '../GroupedActionConfigSection';
import type { WorkflowDesignerCatalogRecord } from '@shared/workflow/runtime/designer/actionCatalog';

const ticketRecord: WorkflowDesignerCatalogRecord = {
  groupKey: 'ticket',
  label: 'Ticket',
  iconToken: 'ticket',
  tileKind: 'core-object',
  allowedActionIds: ['tickets.create', 'tickets.update_fields'],
  description: 'Ticket actions',
  actions: [
    {
      id: 'tickets.create',
      version: 1,
      label: 'Create Ticket',
      description: 'Create a new ticket.',
      inputFieldNames: ['summary'],
      outputFieldNames: ['ticket_id'],
    },
    {
      id: 'tickets.update_fields',
      version: 1,
      label: 'Update Ticket',
      description: 'Update an existing ticket.',
      inputFieldNames: ['ticket_id'],
      outputFieldNames: ['ticket_id'],
    },
  ],
};

const slackRecord: WorkflowDesignerCatalogRecord = {
  groupKey: 'app:slack',
  label: 'Slack',
  iconToken: 'slack',
  tileKind: 'app',
  allowedActionIds: ['slack.send_message'],
  description: 'Slack actions',
  actions: [
    {
      id: 'slack.send_message',
      version: 1,
      label: 'Send Message',
      description: 'Send a Slack message.',
      inputFieldNames: ['channel'],
      outputFieldNames: ['message_id'],
    },
  ],
};

describe('GroupedActionConfigSection', () => {
  it('T081/T097: shows the grouped tile label and invalid state before an action is chosen', () => {
    render(
      <GroupedActionConfigSection
        stepId="step-1"
        record={ticketRecord}
        onActionChange={vi.fn()}
      />
    );

    expect(document.getElementById('workflow-step-group-label-step-1')).toHaveTextContent('Ticket');
    expect(screen.getByText('Action required')).toBeInTheDocument();
    expect(screen.getByText('Select a Ticket action before configuring inputs or publishing this workflow.')).toBeInTheDocument();
  });

  it('T082/T083: builds action-select options from the grouped record only', () => {
    expect(buildGroupedActionSelectOptions(ticketRecord)).toEqual([
      { value: 'tickets.create', label: 'Create Ticket' },
      { value: 'tickets.update_fields', label: 'Update Ticket' },
    ]);
    expect(buildGroupedActionSelectOptions(slackRecord)).toEqual([
      { value: 'slack.send_message', label: 'Send Message' },
    ]);
  });

  it('T083/T087: renders selected app action descriptions without the missing-action warning', () => {
    render(
      <GroupedActionConfigSection
        stepId="step-3"
        record={slackRecord}
        selectedActionId="slack.send_message"
        selectedActionDescription="Send a Slack message."
        onActionChange={vi.fn()}
      />
    );

    expect(document.getElementById('workflow-step-group-label-step-3')).toHaveTextContent('Slack');
    expect(screen.getByText('Send a Slack message.')).toBeInTheDocument();
    expect(screen.queryByText('Action required')).not.toBeInTheDocument();
  });
});
