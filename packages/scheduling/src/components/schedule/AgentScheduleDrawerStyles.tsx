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
        padding: 2px 4px 2px 6px !important;
        /* A tinted fill and a solid left bar: the chip is a booking, not a
           selection; the saturated colour is kept for selected states. */
        background-color: rgb(var(--color-primary-500) / 0.22) !important;
        border-left: 3px solid rgb(var(--color-primary-500)) !important;
        /* A 2px gutter in the grid colour so stacked chips read as separate. */
        outline: 2px solid rgb(var(--color-border-50));
        cursor: grab;
        transition: box-shadow 120ms ease, transform 120ms ease;
      }
      .agent-schedule-view .rbc-event:active {
        cursor: grabbing;
      }
      .agent-schedule-view .rbc-event:hover {
        box-shadow: var(--shadow-card-hover);
        transform: translateY(-1px);
        z-index: 5;
      }
      .agent-schedule-view .rbc-event-content {
        overflow: hidden !important;
        font-size: 12px;
        line-height: 14px;
      }
      .agent-schedule-chip__time {
        font-size: 10.5px;
        line-height: 13px;
        opacity: 0.85;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .agent-schedule-chip__inline-time {
        opacity: 0.9;
        font-weight: 400;
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
      .agent-schedule-chip__title--three {
        -webkit-line-clamp: 3;
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
        position: relative;
        top: -7px;
      }
      .agent-schedule-view .rbc-time-gutter .rbc-timeslot-group:first-child .rbc-label {
        top: 0;
      }
      /* The gutter labels the hour rule; it does not draw cells of its own. */
      .agent-schedule-view .rbc-time-gutter .rbc-time-slot {
        border-top: none !important;
      }
      .agent-schedule-view .rbc-time-gutter .rbc-timeslot-group {
        border-bottom-color: transparent !important;
      }

      /* Thin, theme-matched scrollbar with a reserved gutter so the day
         columns stay equal and the header stays aligned with the grid. */
      .agent-schedule-view .rbc-time-content {
        scrollbar-gutter: stable;
      }
      .agent-schedule-view .rbc-time-header.rbc-overflowing {
        border-right: none !important;
      }
      .agent-schedule-view .rbc-time-content::-webkit-scrollbar {
        width: 8px;
      }
      .agent-schedule-view .rbc-time-content::-webkit-scrollbar-thumb {
        background: rgb(var(--color-primary-500) / 0.45);
        border-radius: 4px;
      }
      .agent-schedule-view .rbc-time-content::-webkit-scrollbar-track {
        background: transparent;
      }
      .agent-schedule-view .rbc-time-content::-webkit-scrollbar-button {
        display: none;
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
        opacity: 0.3;
        transition: opacity 120ms ease;
      }
      /* A 15-minute chip has no room under its text; its grip appears on hover. */
      .agent-schedule-view .rbc-event.agent-schedule-event--short .rbc-addons-dnd-resize-ns-anchor:last-child::after {
        opacity: 0;
      }
      .agent-schedule-view .rbc-event:hover .rbc-addons-dnd-resize-ns-anchor:last-child::after {
        opacity: 0.7;
      }
      .agent-schedule-view .rbc-addons-dnd-resize-ns-anchor .rbc-addons-dnd-resize-ns-icon {
        display: none !important;
      }

      /* Hour lines carry the rhythm; only the half hour is marked between
         them, and quarter marks appear while a drag is in progress. */
      .agent-schedule-view .rbc-day-slot .rbc-time-slot {
        border-top: 1px solid transparent !important;
      }
      .agent-schedule-view .rbc-day-slot .rbc-timeslot-group > .rbc-time-slot:nth-child(3) {
        border-top-color: rgb(var(--color-border-200) / 0.45) !important;
      }
      .agent-schedule-view .rbc-day-slot .rbc-timeslot-group {
        border-bottom: 1px solid rgb(var(--color-border-300)) !important;
      }
      .agent-schedule-view .rbc-addons-dnd-is-dragging .rbc-day-slot .rbc-time-slot,
      .agent-schedule-view .rbc-slot-selecting .rbc-time-slot {
        border-top-color: rgb(var(--color-border-200) / 0.3) !important;
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
        box-shadow: inset 0 0 0 2px rgb(var(--color-primary-600)), var(--shadow-card-hover);
      }
      .agent-schedule-view--work-item .rbc-event.agent-schedule-event--other {
        background-color: rgb(var(--color-border-300) / 0.35) !important;
        border-left-color: rgb(var(--color-border-400)) !important;
        color: rgb(var(--color-text-700)) !important;
      }

      /* The all-day row is empty for most technicians; don't spend a band
         of the drawer on it. */
      .agent-schedule-view--no-all-day .rbc-time-header-content .rbc-allday-cell {
        display: none !important;
      }

      /* Add gray shading for non-working hours (before 8am and after 5pm) */
      .rbc-day-slot .rbc-time-slot {
        border-top: 1px solid rgb(var(--color-border-200));
      }

      /* Non-working hours: 12am-8am */
      .rbc-time-content .rbc-time-column .rbc-timeslot-group:nth-child(-n+8) {
        background-color: rgb(var(--color-border-100));
      }

      /* Non-working hours: 5pm-12am */
      .rbc-time-content .rbc-time-column .rbc-timeslot-group:nth-child(n+18) {
        background-color: rgb(var(--color-border-100));
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
