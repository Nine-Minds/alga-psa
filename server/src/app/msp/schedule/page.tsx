'use client'

import React, { useState, useEffect } from 'react';
import ScheduleCalendar from 'server/src/components/schedule/ScheduleCalendar';
import AppointmentRequestsPanel from 'server/src/components/schedule/AppointmentRequestsPanel';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { Calendar } from 'lucide-react';

export default function SchedulePage() {
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // TODO: Implement actual pending count fetching when appointment request actions are ready
  useEffect(() => {
    // Placeholder - replace with actual API call
    // const fetchPendingCount = async () => {
    //   const result = await getAppointmentRequests({ status: 'pending' });
    //   if (result.success && result.data) {
    //     setPendingCount(result.data.length);
    //   }
    // };
    // fetchPendingCount();
  }, []);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <Button
          id="appointment-requests-button"
          variant="outline"
          onClick={() => setShowRequestsPanel(true)}
          className="relative"
        >
          <Calendar className="h-4 w-4 mr-2" />
          Appointment Requests
          {pendingCount > 0 && (
            <Badge variant="error" className="ml-2 px-2 py-0.5">
              {pendingCount}
            </Badge>
          )}
        </Button>
      </div>
      <div className="h-[calc(100vh-120px)]">
        <ScheduleCalendar />
      </div>

      <AppointmentRequestsPanel
        isOpen={showRequestsPanel}
        onClose={() => setShowRequestsPanel(false)}
        onRequestProcessed={() => {
          // Refresh the schedule calendar when a request is processed
          // This will be handled by the ScheduleCalendar component's internal refresh
        }}
      />
    </div>
  );
}