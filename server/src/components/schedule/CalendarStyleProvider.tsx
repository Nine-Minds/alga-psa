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
        max-height: 40px;
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
    `}</style>
  );
};
