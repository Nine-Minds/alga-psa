import React from 'react';
import ScheduleCalendar from 'server/src/components/schedule/ScheduleCalendar';

export default function SchedulePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Schedule</h1>
      <ScheduleCalendar />
    </div>
  );
}