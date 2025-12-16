'use client'

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import ScheduleCalendar from 'server/src/components/schedule/ScheduleCalendar';
import AppointmentRequestsPanel from 'server/src/components/schedule/AppointmentRequestsPanel';
import AvailabilitySettings from 'server/src/components/schedule/AvailabilitySettings';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { Calendar, Settings } from 'lucide-react';
import { getAppointmentRequests } from 'server/src/lib/actions/appointmentRequestManagementActions';
import { getCurrentUserPermissions, getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getTeams } from 'server/src/lib/actions/team-actions/teamActions';

export default function SchedulePage() {
  const searchParams = useSearchParams();
  const requestIdFromUrl = searchParams.get('requestId');

  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const [showAvailabilitySettings, setShowAvailabilitySettings] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [canConfigureAvailability, setCanConfigureAvailability] = useState(false);
  const [highlightedRequestId, setHighlightedRequestId] = useState<string | null>(null);

  const fetchPendingCount = async () => {
    const result = await getAppointmentRequests({ status: 'pending' });
    if (result.success && result.data) {
      setPendingCount(result.data.length);
    }
  };

  const checkPermissions = async () => {
    const permissions = await getCurrentUserPermissions();
    // User can configure availability if they have 'user:read' permission OR are a team manager
    const hasUserReadPermission = permissions.includes('user:read');

    if (hasUserReadPermission) {
      setCanConfigureAvailability(true);
      return;
    }

    // Check if user is a team manager
    try {
      const currentUser = await getCurrentUser();
      if (currentUser) {
        const teams = await getTeams();
        const isManager = teams.some(team => team.manager_id === currentUser.user_id);
        setCanConfigureAvailability(isManager);
      }
    } catch (error) {
      console.error('Failed to check team manager status:', error);
      setCanConfigureAvailability(false);
    }
  };

  useEffect(() => {
    fetchPendingCount();
    checkPermissions();
  }, [refreshKey]);

  // Auto-open requests panel if requestId is in URL
  useEffect(() => {
    if (requestIdFromUrl) {
      setHighlightedRequestId(requestIdFromUrl);
      setShowRequestsPanel(true);
    }
  }, [requestIdFromUrl]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <div className="flex gap-2">
          {canConfigureAvailability && (
            <Button
              id="configure-availability-button"
              variant="outline"
              onClick={() => setShowAvailabilitySettings(true)}
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure Availability
            </Button>
          )}
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
        <ScheduleCalendar key={refreshKey} />
      </div>

      <AppointmentRequestsPanel
        isOpen={showRequestsPanel}
        onClose={() => {
          setShowRequestsPanel(false);
          setHighlightedRequestId(null);
        }}
        onRequestProcessed={() => {
          // Refresh the pending count and trigger calendar refresh
          setRefreshKey(prev => prev + 1);
        }}
        highlightedRequestId={highlightedRequestId}
      />

      {canConfigureAvailability && (
        <AvailabilitySettings
          isOpen={showAvailabilitySettings}
          onClose={() => setShowAvailabilitySettings(false)}
        />
      )}
    </div>
  );
}