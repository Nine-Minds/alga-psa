'use client';

import React from 'react';
import { IWorkflowEvent } from '@alga-psa/shared/workflow/persistence';

interface WorkflowEventTimelineProps {
  events: IWorkflowEvent[];
}

export default function WorkflowEventTimeline({ events }: WorkflowEventTimelineProps) {
  // Sort events by created_at in descending order (newest first)
  const sortedEvents = [...events].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-[rgb(var(--color-text-500))]">
        No events found for this workflow execution
      </div>
    );
  }

  return (
    <div className="flow-root max-h-[400px] overflow-y-auto pr-2">
      <ul className="-mb-8">
        {sortedEvents.map((event, eventIdx) => (
          <li key={event.event_id}>
            <div className="relative pb-8">
              {eventIdx !== sortedEvents.length - 1 ? (
                <span
                  className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-[rgb(var(--color-border-200))]"
                  aria-hidden="true"
                />
              ) : null}
              <div className="relative flex space-x-3">
                <div>
                  <span
                    className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-[rgb(var(--color-background-100))] ${
                      event.event_name.toLowerCase().includes('error') || event.event_name.toLowerCase().includes('fail')
                        ? 'bg-[rgb(var(--color-accent-100))]'
                        : event.event_name.toLowerCase().includes('complete') || event.event_name.toLowerCase().includes('success')
                        ? 'bg-[rgb(var(--color-primary-100))]'
                        : 'bg-[rgb(var(--color-info-100))]'
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        event.event_name.toLowerCase().includes('error') || event.event_name.toLowerCase().includes('fail')
                          ? 'bg-[rgb(var(--color-accent-500))]'
                          : event.event_name.toLowerCase().includes('complete') || event.event_name.toLowerCase().includes('success')
                          ? 'bg-[rgb(var(--color-primary-500))]'
                          : 'bg-[rgb(var(--color-info-500))]'
                      }`}
                    />
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                  <div>
                    <p className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                      {event.event_name}
                    </p>
                    <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">
                      State transition: {event.from_state} → {event.to_state}
                    </p>
                    {event.payload && Object.keys(event.payload).length > 0 && (
                      <div className="mt-2">
                        <details className="text-xs">
                          <summary className="cursor-pointer text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]">
                            View payload
                          </summary>
                          <pre className="mt-1 p-2 bg-[rgb(var(--color-background-200))] rounded text-[rgb(var(--color-text-700))] overflow-x-auto">
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                  <div className="whitespace-nowrap text-right text-xs text-[rgb(var(--color-text-500))]">
                    <time dateTime={event.created_at}>
                      {new Date(event.created_at).toLocaleString()}
                    </time>
                    {event.user_id && (
                      <p className="mt-0.5">
                        by {event.user_id}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}