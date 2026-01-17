import React from 'react';

export const CalendarStyleProvider: React.FC = () => {
  return (
    <style jsx global>{`
      .rbc-current-time-indicator {
        background-color: rgb(var(--color-secondary-500)) !important;
      }
      .rbc-calendar {
        font-family: inherit;
      }
      .rbc-header {
        display: flex;
        align-items: center;
        padding: 10px;
        font-weight: 600;
        font-size: 0.875rem;
        color: rgb(var(--color-text-700));
        background: rgb(var(--color-border-50));
        border-bottom: 1px solid rgb(var(--color-border-200));
      }
      .rbc-off-range-bg {
        background-color: rgb(var(--color-border-100));
      }
      .rbc-today {
        background-color: rgb(var(--color-primary-100)) !important;
      }
      .rbc-button-link {
        padding: 10px;
      }
      .rbc-event {
        padding: 4px 8px;
        border-radius: 6px;
        border: none;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        transition: background-color 0.2s;
        position: relative;
      }
      .rbc-event-label {
        font-size: 0.75rem;
      }
      
      /* Exclude our custom view switcher from rbc-toolbar button styles */
      .rbc-toolbar button:not([id^="schedule-view-"]):not([id$="-view-btn"]) {
        color: rgb(var(--color-text-700));
        border: 1px solid rgb(var(--color-border-200));
        border-radius: 6px;
        padding: 8px 12px;
        font-weight: 500;
      }
      
      .rbc-toolbar button:not([id^="schedule-view-"]):not([id$="-view-btn"]):hover {
        background-color: rgb(var(--color-border-100));
      }
      
      .rbc-toolbar button:not([id^="schedule-view-"]):not([id$="-view-btn"]).rbc-active {
        background-color: rgb(var(--color-primary-500));
        color: white;
        border-color: rgb(var(--color-primary-600));
      }
      
      /* Force purple background for active ViewSwitcher buttons */
      .rbc-toolbar button[id$="-view-btn"][aria-pressed="true"] {
        background-color: rgb(var(--color-primary-500)) !important;
        color: white !important;
        border-color: rgb(var(--color-primary-500)) !important;
      }
      
      .rbc-toolbar button[id$="-view-btn"][aria-pressed="false"] {
        background-color: transparent !important;
        color: rgb(var(--color-text-700)) !important;
        border-color: rgb(var(--color-border-200)) !important;
      }
      
      /* Custom border radius for grouped buttons */
      .rbc-toolbar button[id="month-view-btn"] {
        border-top-left-radius: 0.375rem !important;
        border-bottom-left-radius: 0.375rem !important;
        border-top-right-radius: 0 !important;
        border-bottom-right-radius: 0 !important;
      }
      
      .rbc-toolbar button[id="week-view-btn"] {
        border-radius: 0 !important;
      }
      
      .rbc-toolbar button[id="day-view-btn"] {
        border-top-left-radius: 0 !important;
        border-bottom-left-radius: 0 !important;
        border-top-right-radius: 0.375rem !important;
        border-bottom-right-radius: 0.375rem !important;
      }
      .rbc-time-content {
        border-top: 1px solid rgb(var(--color-border-200));
        position: relative;
      }
      .rbc-timeslot-group {
        min-height: 60px;
        border-bottom: 1px solid rgb(var(--color-border-200));
      }
      .rbc-time-slot {
        color: rgb(var(--color-text-600));
        border-top: 1px solid rgb(var(--color-border-200));
      }
      .rbc-time-column {
        position: relative;
        border-left: 1px solid rgb(var(--color-border-200));
      }
      .rbc-day-slot .rbc-time-slot {
        border-top: 1px solid rgb(var(--color-border-200));
        position: relative;
      }
      .rbc-time-view {
        border: 1px solid rgb(var(--color-border-200));
      }
      .rbc-allday-cell {
        border-bottom: 1px solid rgb(var(--color-border-200));
        min-height: 36px;
        overflow: auto;
      }
      .rbc-time-header.rbc-overflowing {
        border-right: 1px solid rgb(var(--color-border-200));
      }
      .rbc-time-header-content {
        border-left: 1px solid rgb(var(--color-border-200));
      }
      .rbc-day-slot .rbc-events-container {
        margin-right: 0;
      }
      .rbc-time-content > * + * > * {
        border-left: 1px solid rgb(var(--color-border-200));
      }
      .rbc-timeslot-group {
        display: flex;
        flex-direction: column;
        border-bottom: 1px solid rgb(var(--color-border-200));
      }
      .rbc-time-slot {
        flex: 1;
        min-height: 30px;
        border-top: 1px solid rgb(var(--color-border-200));
      }
      .rbc-events-container {
        position: relative;
      }
      .rbc-time-gutter {
        position: relative;
      }
      .rbc-day-slot {
        position: relative;
      }
      .rbc-day-slot::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 1px;
        background: rgb(var(--color-border-200));
      }

      /* Multi-day event styles */
      .rbc-event-continues-prior {
        border-top-left-radius: 0 !important;
        border-bottom-left-radius: 0 !important;
        position: relative;
        padding-left: 12px !important;
      }

      .rbc-event-continues-prior::before {
        content: '←';
        position: absolute;
        left: 2px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 10px;
        opacity: 0.6;
      }

      /* Show abbreviated title for events continuing from previous week */
      .rbc-week-view .rbc-event-continues-prior .rbc-event-label,
      .rbc-day-view .rbc-event-continues-prior .rbc-event-label {
        display: block !important;
        font-size: 10px;
        opacity: 0.8;
      }

      /* Add visual indicator for events that span multiple weeks */
      .rbc-event-allday.rbc-event-continues-prior.rbc-event-continues-after {
        background: repeating-linear-gradient(
          45deg,
          var(--event-bg-color, rgb(var(--color-primary-200))),
          var(--event-bg-color, rgb(var(--color-primary-200))) 10px,
          rgba(var(--color-primary-300), 0.3) 10px,
          rgba(var(--color-primary-300), 0.3) 20px
        );
      }

      .rbc-event-continues-after {
        border-top-right-radius: 0 !important;
        border-bottom-right-radius: 0 !important;
        position: relative;
        padding-right: 12px !important;
      }

      .rbc-event-continues-after::after {
        content: '→';
        position: absolute;
        right: 2px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 10px;
        opacity: 0.6;
      }

      /* Month view multi-day event styling */
      .rbc-month-view .rbc-event {
        min-height: 30px;
        height: auto;
        display: flex;
        align-items: center;
      }

      .rbc-month-view .rbc-event-continues-prior,
      .rbc-month-view .rbc-event-continues-after {
        background: linear-gradient(90deg,
          var(--event-bg-color, rgb(var(--color-primary-200))) 0%,
          var(--event-bg-color, rgb(var(--color-primary-200))) 85%,
          rgba(var(--color-primary-200), 0.6) 100%);
      }

      /* Week/day view multi-day in all-day section */
      .rbc-allday-cell .rbc-event {
        min-height: 30px;
        height: 30px;
        line-height: 20px;
        font-size: 12px;
        display: flex;
        align-items: center;
        padding: 2px 4px;
      }

      /* Restrict multi-day event dragging to horizontal only */
      .rbc-allday-cell .rbc-addons-dnd-dragging {
        cursor: ew-resize !important;
      }

      /* Visual feedback for multi-day event dragging */
      .rbc-allday-cell .rbc-event.rbc-addons-dnd-dragging {
        opacity: 0.7;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        z-index: 1000;
      }

      /* === Multi-day event drag styling === */
      /* Only apply 30px height to multi-day events, not single-day events */

      /* Multi-day events in all-day section maintain size during drag */
      .rbc-allday-cell .rbc-addons-dnd-dragging.rbc-event,
      .rbc-allday-cell .rbc-addons-dnd-drag-preview {
        height: 30px !important;
        min-height: 30px !important;
        max-height: 30px !important;
      }

      /* Visual feedback for dragging */
      .rbc-allday-cell .rbc-addons-dnd-drag-preview {
        opacity: 0.8;
      }

      /* Multi-day events in month view during drag */
      .rbc-month-view .rbc-row-segment .rbc-event.rbc-addons-dnd-dragging {
        height: 30px !important;
        max-height: 30px !important;
      }

      /* Single-day events in time grid should NOT be constrained to 30px */
      /* They maintain their duration-based height */
      .rbc-time-slot .rbc-event.rbc-addons-dnd-dragging {
        /* Let the calendar determine height based on duration */
        height: auto;
        max-height: none;
      }

      /* Prevent the resize handle during drag */
      .rbc-addons-dnd-dragging .rbc-addons-dnd-resize-ns-icon,
      .rbc-addons-dnd-dragging .rbc-addons-dnd-resize-ew-icon {
        display: none !important;
      }

      /* Week boundary indicators during drag */
      .rbc-week-view.dragging-near-boundary::before,
      .rbc-week-view.dragging-near-boundary::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: 50px;
        pointer-events: none;
        z-index: 999;
      }

      .rbc-week-view.dragging-to-previous::before {
        left: 0;
        background: linear-gradient(90deg,
          rgba(var(--color-primary-500), 0.2) 0%,
          transparent 100%);
        border-left: 2px dashed rgb(var(--color-primary-500));
      }

      .rbc-week-view.dragging-to-next::after {
        right: 0;
        background: linear-gradient(270deg,
          rgba(var(--color-primary-500), 0.2) 0%,
          transparent 100%);
        border-right: 2px dashed rgb(var(--color-primary-500));
      }

      /* Week view specific dragging styles */
      .rbc-week-view .rbc-addons-dnd-dragging,
      .rbc-day-view .rbc-addons-dnd-dragging {
        pointer-events: none;
      }

      /* Visual connector for multi-day events */
      .rbc-row-segment .rbc-event-continues-prior,
      .rbc-row-segment .rbc-event-continues-after {
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
      }
    `}</style>
  );
};
