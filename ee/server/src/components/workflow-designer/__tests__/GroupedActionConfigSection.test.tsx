/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupedActionConfigSection, buildGroupedActionSelectOptions } from '../GroupedActionConfigSection';
import type { WorkflowDesignerCatalogRecord } from '@alga-psa/workflows/runtime/designer/actionCatalog';

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

const transformRecord: WorkflowDesignerCatalogRecord = {
  groupKey: 'transform',
  label: 'Transform',
  iconToken: 'transform',
  tileKind: 'transform',
  allowedActionIds: ['transform.truncate_text', 'transform.build_object'],
  description: 'Shape data without writing expressions.',
  actions: [
    {
      id: 'transform.truncate_text',
      version: 1,
      label: 'Truncate Text',
      description: 'Shorten text using explicit truncation settings.',
      inputFieldNames: ['text', 'maxLength', 'strategy'],
      outputFieldNames: ['text'],
    },
    {
      id: 'transform.build_object',
      version: 1,
      label: 'Build Object',
      description: 'Construct an object from explicit named inputs.',
      inputFieldNames: ['fields'],
      outputFieldNames: ['object'],
    },
  ],
};

describe('GroupedActionConfigSection', () => {
  afterEach(() => {
    cleanup();
  });

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

  it('T082/T083/T321: builds action-select options from only the selected grouped business or app record', () => {
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

  it('T221/T222/T239: renders Transform like any other grouped action source and limits selection to transform actions', () => {
    render(
      <GroupedActionConfigSection
        stepId="step-transform"
        record={transformRecord}
        selectedActionId="transform.truncate_text"
        selectedActionDescription="Shorten text using explicit truncation settings."
        onActionChange={vi.fn()}
      />
    );

    expect(document.getElementById('workflow-step-group-label-step-transform')).toHaveTextContent(
      'Transform'
    );
    expect(buildGroupedActionSelectOptions(transformRecord)).toEqual([
      { value: 'transform.truncate_text', label: 'Truncate Text' },
      { value: 'transform.build_object', label: 'Build Object' },
    ]);
    expect(screen.getByText('Shorten text using explicit truncation settings.')).toBeInTheDocument();
    expect(screen.queryByText('Action required')).not.toBeInTheDocument();
  });

  it('T295/T296: keeps grouped action details visible for read-only steps while disabling action changes', () => {
    render(
      <GroupedActionConfigSection
        stepId="step-readonly"
        record={transformRecord}
        selectedActionId="transform.truncate_text"
        selectedActionDescription="Shorten text using explicit truncation settings."
        onActionChange={vi.fn()}
        disabled
      />
    );

    expect(document.getElementById('workflow-step-group-label-step-readonly')).toHaveTextContent(
      'Transform'
    );
    expect(screen.getByText('Shorten text using explicit truncation settings.')).toBeInTheDocument();
    expect(
      document.getElementById('workflow-step-action-select-step-readonly')
    ).toBeDisabled();
  });
});
