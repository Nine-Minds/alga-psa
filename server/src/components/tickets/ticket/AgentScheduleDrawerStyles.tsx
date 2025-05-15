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
      .w-64.flex-shrink-0.bg-white {
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
        background-color: white !important;
      }
      
      /* Keep the toolbar fixed */
      .rbc-toolbar {
        position: sticky !important;
        top: 0 !important;
        z-index: 20 !important;
        background-color: white !important;
        padding: 10px 0 !important;
      }
    `}</style>
  );
};
