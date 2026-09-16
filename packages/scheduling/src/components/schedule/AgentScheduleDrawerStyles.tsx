import React from 'react';

export const AgentScheduleDrawerStyles: React.FC = () => {
  return (
    <style jsx global>{`
      /* Make the calendar title more prominent */
      .rbc-toolbar-label {
        font-size: 1.25rem !important;
        font-weight: 600 !important;
      }

      /* Ensure the calendar takes full width */
      .flex-grow.relative {
        width: 100% !important;
      }

      /* Hide the technician sidebar if it exists */
      .w-64.flex-shrink-0.bg-white,
      .w-64.flex-shrink-0.bg-\\[rgb\\(var\\(--color-card\\)\\)\\] {
        display: none !important;
      }

      /* Calendar container */
      .rbc-calendar {
        height: 100% !important;
      }

      /* Month view specific styles */
      .rbc-month-view {
        height: 100% !important;
      }

      .rbc-month-row {
        min-height: 100px !important;
      }

      /* Ensure month cells are visible */
      .rbc-month-view .rbc-month-row .rbc-row-content {
        height: auto !important;
        min-height: 80px !important;
      }

      /* Hide the default event label to prevent duplicate time display */
      .rbc-event-label {
        display: none !important;
      }

      /* Ensure events fill their container properly */
      .rbc-event-content {
        width: 100% !important;
        height: 100% !important;
      }

      /* Chips: one ellipsized line each for time and title; the full
         title is in the tooltip. A 1px halo in the grid colour separates
         chips that touch. */
      .agent-schedule-view .rbc-event {
        padding: 2px 3px !important;
        /* A 2px gutter in the grid colour so stacked chips read as separate. */
        outline: 2px solid rgb(var(--color-border-50));
        cursor: grab;
        transition: box-shadow 120ms ease, transform 120ms ease;
      }
      .agent-schedule-view .rbc-event:active {
        cursor: grabbing;
      }
      .agent-schedule-view .rbc-event:hover {
        box-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
        transform: translateY(-1px);
        z-index: 5;
      }
      .agent-schedule-view .rbc-event-content {
        overflow: hidden !important;
        font-size: 11px;
        line-height: 14px;
        letter-spacing: -0.01em;
      }
      .agent-schedule-chip__title {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        white-space: normal;
        word-break: normal;
        /* Wrap between words; split a word only when it cannot fit a line by itself. */
        overflow-wrap: break-word;
      }
      .agent-schedule-chip__title--one {
        -webkit-line-clamp: 1;
        overflow-wrap: normal;
        text-overflow: ellipsis;
      }

      /* Short gutter labels ("8 AM") leave more width for the seven days. */
      .agent-schedule-view .rbc-time-gutter,
      .agent-schedule-view .rbc-time-header-gutter {
        min-width: 52px;
      }
      .agent-schedule-view .rbc-time-gutter .rbc-label {
        font-size: 11px;
        padding: 0 4px;
      }

      /* Thin, theme-matched scrollbar with a reserved gutter so the day
         columns stay equal and the header stays aligned with the grid. */
      .agent-schedule-view .rbc-time-content {
        scrollbar-width: thin;
        scrollbar-color: rgb(var(--color-border-300)) transparent;
        scrollbar-gutter: stable;
      }
      .agent-schedule-view .rbc-time-content::-webkit-scrollbar {
        width: 8px;
      }
      .agent-schedule-view .rbc-time-content::-webkit-scrollbar-thumb {
        background: rgb(var(--color-border-300));
        border-radius: 4px;
      }
      .agent-schedule-view .rbc-time-content::-webkit-scrollbar-track,
      .agent-schedule-view .rbc-time-content::-webkit-scrollbar-button {
        background: transparent;
        height: 0;
      }

      /* Today and now are the dispatcher's anchors. */
      .agent-schedule-view .rbc-day-slot.rbc-today,
      .agent-schedule-view .rbc-header.rbc-today {
        background-color: rgb(var(--color-primary-500) / 0.14) !important;
      }
      .agent-schedule-view .rbc-header.rbc-today {
        color: rgb(var(--color-primary-600));
        font-weight: 600;
      }
      .agent-schedule-view .rbc-current-time-indicator {
        height: 2px;
        background-color: rgb(var(--color-accent-500)) !important;
      }
      .agent-schedule-toolbar .rbc-toolbar-label {
        font-size: 1.05rem !important;
        font-weight: 600 !important;
      }
      /* Resize grip: a short bar at the bottom edge, shown on hover. */
      .agent-schedule-view .rbc-addons-dnd-resize-ns-anchor {
        height: 8px;
      }
      .agent-schedule-view .rbc-addons-dnd-resize-ns-anchor:last-child::after {
        content: '';
        position: absolute;
        left: 50%;
        bottom: 2px;
        width: 16px;
        height: 3px;
        margin-left: -8px;
        border-radius: 2px;
        background: rgb(var(--color-text-900));
        opacity: 0;
        transition: opacity 120ms ease;
      }
      .agent-schedule-view .rbc-event:hover .rbc-addons-dnd-resize-ns-anchor:last-child::after {
        opacity: 0.55;
      }
      .agent-schedule-view .rbc-addons-dnd-resize-ns-anchor .rbc-addons-dnd-resize-ns-icon {
        display: none !important;
      }

      /* The first day column gets the same divider as the rest. */
      .agent-schedule-view .rbc-time-content > .rbc-time-gutter + .rbc-day-slot {
        border-left: 1px solid rgb(var(--color-border-200));
      }

      /* Day headers only need the day name and number. */
      .agent-schedule-view .rbc-time-header-cell .rbc-header {
        padding: 6px 4px !important;
        line-height: 1.2 !important;
      }

      /* Entries for the work item being scheduled stand out; everything
         else recedes so the dispatcher can find this ticket's bookings. */
      .agent-schedule-view--work-item .rbc-event.agent-schedule-event--this-work-item {
        box-shadow: inset 0 0 0 2px rgb(var(--color-primary-600));
        font-weight: 600;
      }
      .agent-schedule-view--work-item .rbc-event.agent-schedule-event--this-work-item:hover {
        box-shadow: inset 0 0 0 2px rgb(var(--color-primary-600)), 0 4px 12px rgb(0 0 0 / 0.25);
      }
      .agent-schedule-view--work-item .rbc-event.agent-schedule-event--other {
        color: rgb(var(--color-text-700)) !important;
      }

      /* The all-day row is empty for most technicians; don't spend a band
         of the drawer on it. */
      .agent-schedule-view--no-all-day .rbc-time-header-content .rbc-allday-cell {
        display: none !important;
      }

      /* Add gray shading for non-working hours (before 8am and after 5pm) */
      .rbc-day-slot .rbc-time-slot {
        border-top: 1px solid #f0f0f0;
      }

      /* Non-working hours: 12am-8am */
      .rbc-time-content .rbc-time-column .rbc-timeslot-group:nth-child(-n+8) {
        background-color: rgba(0, 0, 0, 0.05);
      }

      /* Non-working hours: 5pm-12am */
      .rbc-time-content .rbc-time-column .rbc-timeslot-group:nth-child(n+18) {
        background-color: rgba(0, 0, 0, 0.05);
      }

      /* Make the time content area independently scrollable */
      .rbc-time-content {
        overflow-y: auto !important;
        max-height: calc(100vh - 200px) !important;
      }

      /* Keep the header fixed */
      .rbc-time-header {
        position: sticky !important;
        top: 0 !important;
        z-index: 10 !important;
        background-color: rgb(var(--color-card)) !important;
      }

      /* Keep the toolbar fixed */
      .rbc-toolbar {
        position: sticky !important;
        top: 0 !important;
        z-index: 20 !important;
        background-color: rgb(var(--color-card)) !important;
        padding: 10px 0 !important;
      }
    `}</style>
  );
};
