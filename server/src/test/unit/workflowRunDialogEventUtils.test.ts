import { describe, it, expect } from 'vitest';
import {
  filterEventCatalogEntries,
  getSchemaDiffSummary,
  pickEventTemplates
} from '@ee/components/workflow-designer/workflowRunDialogUtils';

describe('workflowRunDialogUtils', () => {
  it('filters event catalog entries by search term', () => {
    const entries = [
      { event_type: 'TICKET_CREATED', name: 'Ticket Created', category: 'Tickets', description: 'New ticket' },
      { event_type: 'INBOUND_EMAIL_RECEIVED', name: 'Inbound Email', category: 'Email Processing', description: 'Inbound email' }
    ];

    expect(filterEventCatalogEntries(entries, 'ticket')).toHaveLength(1);
    expect(filterEventCatalogEntries(entries, 'email')).toHaveLength(1);
    expect(filterEventCatalogEntries(entries, 'processing')).toHaveLength(1);
    expect(filterEventCatalogEntries(entries, 'missing')).toHaveLength(0);
  });

  it('summarizes schema differences for event vs payload schemas', () => {
    const payloadSchema = {
      type: 'object',
      properties: {
        emailData: { type: 'object' },
        tenantId: { type: 'string' }
      },
      required: ['emailData']
    };
    const eventSchema = {
      type: 'object',
      properties: {
        emailData: { type: 'object' },
        providerId: { type: 'string' }
      },
      required: ['emailData', 'providerId']
    };

    const summary = getSchemaDiffSummary(payloadSchema, eventSchema);
    expect(summary?.onlyInEvent).toEqual(['providerId']);
    expect(summary?.onlyInPayload).toEqual(['tenantId']);
    expect(summary?.requiredOnlyInEvent).toEqual(['providerId']);
  });

  it('picks event templates based on event type or category', () => {
    expect(pickEventTemplates({ eventType: 'INBOUND_EMAIL_RECEIVED' })).toContain('email');
    expect(pickEventTemplates({ category: 'Webhook Events' })).toContain('webhook');
    expect(pickEventTemplates({ eventType: 'TICKET_CREATED', category: 'Tickets' })).toEqual([]);
  });
});
