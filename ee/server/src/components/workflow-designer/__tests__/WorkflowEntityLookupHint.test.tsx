/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkflowEntityLookupHint } from '../WorkflowEntityLookupHint';
import { buildWorkflowEventDetailTips } from '../workflowEntityLookupSuggestions';

afterEach(() => cleanup());

describe('WorkflowEntityLookupHint detail tips', () => {
  it('says where the customer reply text is, even with no lookup suggestion left', () => {
    render(
      <WorkflowEntityLookupHint
        idPrefix="trigger"
        suggestions={[]}
        getActionLabel={() => 'Find Ticket'}
        onAdd={vi.fn()}
        detailTips={buildWorkflowEventDetailTips('TICKET_CUSTOMER_REPLIED', [])}
        getLookupLabel={() => 'Find Ticket'}
      />
    );
    const tip = document.getElementById('trigger-event-detail-tip-customerReplyText');
    expect(tip?.textContent).toContain('“Find Ticket” › latest_customer_comment.note');
  });

  it('renders nothing without suggestions or tips', () => {
    const { container } = render(
      <WorkflowEntityLookupHint idPrefix="trigger" suggestions={[]} getActionLabel={() => ''} onAdd={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });
});
