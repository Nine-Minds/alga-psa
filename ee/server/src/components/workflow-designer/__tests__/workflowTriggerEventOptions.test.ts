import { describe, expect, it } from 'vitest';

import {
  buildWorkflowTriggerEventCategoryOptions,
  buildWorkflowEventSearchKeywords,
  buildWorkflowTriggerEventOptions,
  getWorkflowTriggerEventCategoryKey,
  WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_OTHER,
  WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN,
} from '../workflowTriggerEventOptions';

const entries = [
  {
    event_id: '1',
    event_type: 'ticket.created',
    name: 'Ticket Created',
    description: null,
    category: 'Tickets',
    payload_schema_ref: 'payload.TicketCreated.v1',
    payload_schema_ref_status: 'known' as const,
    source: 'system' as const,
    status: 'active' as const,
  },
  {
    event_id: '2',
    event_type: 'ticket.updated',
    name: 'Ticket Updated',
    description: null,
    category: 'Tickets',
    payload_schema_ref: 'payload.TicketUpdated.v1',
    payload_schema_ref_status: 'known' as const,
    source: 'system' as const,
    status: 'active' as const,
  },
  {
    event_id: '3',
    event_type: 'contact.created',
    name: 'Contact Created',
    description: null,
    category: 'Contacts',
    payload_schema_ref: 'payload.ContactCreated.v1',
    payload_schema_ref_status: 'known' as const,
    source: 'tenant' as const,
    status: 'active' as const,
  },
  {
    event_id: '4',
    event_type: 'misc.changed',
    name: 'Misc Changed',
    description: null,
    category: null,
    payload_schema_ref: 'payload.MiscChanged.v1',
    payload_schema_ref_status: 'known' as const,
    source: 'tenant' as const,
    status: 'active' as const,
  },
];

describe('workflowTriggerEventOptions', () => {
  it('normalizes blank categories into the Other bucket', () => {
    expect(getWorkflowTriggerEventCategoryKey(null)).toBe(WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_OTHER);
    expect(getWorkflowTriggerEventCategoryKey('   ')).toBe(WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_OTHER);
    expect(getWorkflowTriggerEventCategoryKey('Tickets')).toBe('Tickets');
  });

  it('builds distinct sorted category options and includes Unknown event for missing saved triggers', () => {
    expect(buildWorkflowTriggerEventCategoryOptions(entries, 'missing.event')).toEqual([
      { value: 'Contacts', label: 'Contacts' },
      { value: WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_OTHER, label: 'Other' },
      { value: 'Tickets', label: 'Tickets' },
      { value: WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN, label: 'Unknown event' },
    ]);
  });

  it('filters event options to the selected category and preserves unknown saved events in the Unknown bucket', () => {
    expect(buildWorkflowTriggerEventOptions(entries, 'Tickets')).toEqual([
      expect.objectContaining({ value: 'ticket.created', label: 'Ticket Created (ticket.created)' }),
      expect.objectContaining({ value: 'ticket.updated', label: 'Ticket Updated (ticket.updated)' }),
    ]);

    expect(buildWorkflowTriggerEventOptions(entries, WORKFLOW_TRIGGER_EVENT_CATEGORY_KEY_UNKNOWN, 'missing.event')).toEqual([
      { value: 'missing.event', label: 'Unknown event (missing.event)' },
    ]);
  });

  it('gives every event option search keywords from its name, code, description, category, and synonyms', () => {
    const keywords = buildWorkflowEventSearchKeywords({
      name: 'Ticket Customer Replied',
      event_type: 'TICKET_CUSTOMER_REPLIED',
      description: 'A contact replied to a ticket by email or in the portal',
      category: 'Tickets',
    });
    expect(keywords).toContain('reply');
    expect(keywords).toContain('portal');
    expect(keywords).toContain('tickets');

    // Description words are searchable but not expanded into synonyms.
    const surveyExpired = buildWorkflowEventSearchKeywords({
      name: 'Survey Expired',
      event_type: 'SURVEY_EXPIRED',
      description: 'Survey expired without response.',
      category: 'Surveys',
    });
    expect(surveyExpired).toContain('response');
    expect(surveyExpired).not.toContain('reply');
    expect(surveyExpired).not.toContain('replied');

    const [created] = buildWorkflowTriggerEventOptions(entries, 'Tickets');
    expect(created.keywords).toContain('new');
  });
});

