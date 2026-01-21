'use client';

import React, { useState } from 'react';
import { TicketTimeline } from 'server/src/components/tickets/ticket/TicketTimeline';
import { TimelineItem, TimelineDateSeparator } from 'server/src/components/tickets/ticket/TimelineItem';
import { ActivityIcon, getActivityLabel } from 'server/src/components/ui/ActivityIcon';
import { FieldChangeDiff } from 'server/src/components/tickets/ticket/FieldChangeDiff';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { ITicketActivity, TicketActivityType } from 'server/src/interfaces/ticketActivity.interfaces';

/**
 * Test page for viewing Ticket Timeline feature
 * Access at: /msp/test-timeline
 *
 * DELETE THIS FILE when ready to integrate into TicketDetails
 */

// Sample activities for demo
const SAMPLE_ACTIVITIES: ITicketActivity[] = [
  {
    activity_id: '1',
    tenant: 'test',
    ticket_id: 'test-ticket',
    activity_type: 'ticket_created',
    actor_id: 'user-1',
    actor_type: 'internal',
    actor_name: 'John Smith',
    metadata: {},
    is_internal: false,
    is_system: false,
    created_at: new Date().toISOString()
  },
  {
    activity_id: '2',
    tenant: 'test',
    ticket_id: 'test-ticket',
    activity_type: 'assignment_change',
    actor_id: 'user-1',
    actor_type: 'internal',
    actor_name: 'John Smith',
    field_name: 'assigned_to',
    old_value: null,
    new_value: 'user-2',
    metadata: { assignee_name: 'Jane Doe' },
    is_internal: false,
    is_system: false,
    created_at: new Date(Date.now() - 3600000).toISOString()
  },
  {
    activity_id: '3',
    tenant: 'test',
    ticket_id: 'test-ticket',
    activity_type: 'status_change',
    actor_id: 'user-2',
    actor_type: 'internal',
    actor_name: 'Jane Doe',
    field_name: 'status',
    old_value: 'Open',
    new_value: 'In Progress',
    metadata: {},
    is_internal: false,
    is_system: false,
    created_at: new Date(Date.now() - 7200000).toISOString()
  },
  {
    activity_id: '4',
    tenant: 'test',
    ticket_id: 'test-ticket',
    activity_type: 'comment_added',
    actor_id: 'user-2',
    actor_type: 'internal',
    actor_name: 'Jane Doe',
    comment_id: 'comment-1',
    metadata: {},
    is_internal: true,
    is_system: false,
    created_at: new Date(Date.now() - 86400000).toISOString()
  },
  {
    activity_id: '5',
    tenant: 'test',
    ticket_id: 'test-ticket',
    activity_type: 'priority_change',
    actor_id: 'user-1',
    actor_type: 'internal',
    actor_name: 'John Smith',
    field_name: 'priority',
    old_value: 'Medium',
    new_value: 'High',
    metadata: {},
    is_internal: false,
    is_system: false,
    created_at: new Date(Date.now() - 172800000).toISOString()
  },
  {
    activity_id: '6',
    tenant: 'test',
    ticket_id: 'test-ticket',
    activity_type: 'email_received',
    actor_id: null,
    actor_type: 'email',
    actor_name: 'customer@example.com',
    email_id: 'email-1',
    metadata: {},
    is_internal: false,
    is_system: false,
    created_at: new Date(Date.now() - 259200000).toISOString()
  }
];

const ALL_ACTIVITY_TYPES: TicketActivityType[] = [
  'ticket_created',
  'ticket_closed',
  'ticket_reopened',
  'status_change',
  'assignment_change',
  'priority_change',
  'category_change',
  'field_change',
  'custom_field_change',
  'comment_added',
  'comment_edited',
  'comment_deleted',
  'email_sent',
  'email_received',
  'document_attached',
  'document_removed',
  'bundle_created',
  'bundle_child_added',
  'bundle_child_removed',
  'time_entry_added',
  'time_entry_updated',
  'sla_breach',
  'sla_warning',
  'escalation',
  'merge',
  'split'
];

export default function TestTimelinePage() {
  const [ticketId, setTicketId] = useState('');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-sm text-yellow-800">
          <strong>Test Page:</strong> This is a temporary page for previewing the Ticket Timeline feature.
          Delete <code>src/app/(authenticated)/msp/test-timeline/page.tsx</code> when ready to integrate.
        </p>
      </div>

      {/* Activity Icons Gallery */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Activity Icons Gallery</h2>
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
          {ALL_ACTIVITY_TYPES.map((type) => (
            <div key={type} className="flex flex-col items-center gap-2 p-3 bg-white rounded-lg border">
              <ActivityIcon activityType={type} size="md" />
              <span className="text-xs text-gray-600 text-center">
                {getActivityLabel(type)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Field Change Diff Examples */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Field Change Diff Examples</h2>
        <div className="space-y-4 bg-white p-4 rounded-lg border">
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Inline Variant:</h3>
            <div className="space-y-2">
              <FieldChangeDiff fieldName="Status" oldValue="Open" newValue="In Progress" variant="inline" />
              <FieldChangeDiff fieldName="Priority" oldValue="Medium" newValue="High" variant="inline" />
              <FieldChangeDiff fieldName="Assigned To" oldValue={null} newValue="Jane Doe" variant="inline" />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Block Variant:</h3>
            <div className="grid grid-cols-2 gap-4">
              <FieldChangeDiff fieldName="Description" oldValue="Original text" newValue="Updated description with more details" variant="block" />
              <FieldChangeDiff fieldName="Due Date" oldValue="2025-01-15" newValue="2025-01-20" variant="block" />
            </div>
          </div>
        </div>
      </section>

      {/* Sample Timeline */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Sample Timeline (Demo Data)</h2>
        <div className="bg-white p-4 rounded-lg border">
          <TimelineDateSeparator date={new Date().toISOString().split('T')[0]} />
          {SAMPLE_ACTIVITIES.slice(0, 3).map((activity, index) => (
            <TimelineItem
              key={activity.activity_id}
              activity={activity}
              showConnector={index < 2}
            />
          ))}
          <TimelineDateSeparator date={new Date(Date.now() - 86400000).toISOString().split('T')[0]} />
          {SAMPLE_ACTIVITIES.slice(3).map((activity, index, arr) => (
            <TimelineItem
              key={activity.activity_id}
              activity={activity}
              showConnector={index < arr.length - 1}
            />
          ))}
        </div>
      </section>

      {/* Live Timeline (requires ticket ID) */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Live Timeline</h2>
        <div className="bg-white p-4 rounded-lg border">
          <div className="flex items-center gap-4 mb-4">
            <Input
              id="ticket-id-input"
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              placeholder="Enter a ticket ID to load timeline..."
              containerClassName="flex-1 mb-0"
            />
            <Button
              id="load-timeline"
              disabled={!ticketId}
              onClick={() => {/* Trigger reload */}}
            >
              Load
            </Button>
          </div>

          {ticketId ? (
            <TicketTimeline ticketId={ticketId} />
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>Enter a ticket ID above to load its activity timeline</p>
              <p className="text-sm mt-1">
                (Make sure you've run the migration: <code>npx knex migrate:latest</code>)
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
