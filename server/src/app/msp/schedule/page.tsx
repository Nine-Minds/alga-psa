'use client'

import React from 'react';
import ScheduleCalendar from 'server/src/components/schedule/ScheduleCalendar';

export default function SchedulePage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-2">Schedule</h1>
      <div className="h-[calc(100vh-120px)]">
        <ScheduleCalendar />
      </div>
    </div>
  );
}