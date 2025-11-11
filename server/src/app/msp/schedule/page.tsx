'use client'

import React, { useState, useEffect } from 'react';
import ScheduleCalendar from 'server/src/components/schedule/ScheduleCalendar';
import AppointmentRequestsPanel from 'server/src/components/schedule/AppointmentRequestsPanel';
import AvailabilitySettings from 'server/src/components/schedule/AvailabilitySettings';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { Calendar, Settings } from 'lucide-react';
import { getAppointmentRequests } from 'server/src/lib/actions/appointmentRequestManagementActions';

export default function SchedulePage() {
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const [showAvailabilitySettings, setShowAvailabilitySettings] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchPendingCount = async () => {
    const result = await getAppointmentRequests({ status: 'pending' });
    if (result.success && result.data) {
      setPendingCount(result.data.length);
    }
  };

  useEffect(() => {
    fetchPendingCount();
  }, [refreshKey]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <div className="flex gap-2">
          <Button
            id="configure-availability-button"
            variant="outline"
            onClick={() => setShowAvailabilitySettings(true)}
          >
            <Settings className="h-4 w-4 mr-2" />
            Configure Availability
          </Button>
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
      </div>
      <div className="h-[calc(100vh-120px)]">
        <ScheduleCalendar />
      </div>

      <AppointmentRequestsPanel
        isOpen={showRequestsPanel}
        onClose={() => setShowRequestsPanel(false)}
        onRequestProcessed={() => {
          // Refresh the pending count and trigger calendar refresh
          setRefreshKey(prev => prev + 1);
        }}
      />

      <AvailabilitySettings
        isOpen={showAvailabilitySettings}
        onClose={() => setShowAvailabilitySettings(false)}
      />
    </div>
  );
}