'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import ScheduleCalendar from './ScheduleCalendar';
import AppointmentRequestsPanel from './AppointmentRequestsPanel';
import AvailabilitySettings from './AvailabilitySettings';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Calendar, Settings } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAppointmentRequests, getAvailabilitySettingsAccess } from '@alga-psa/scheduling/actions';
import {
  isReloadNavigation,
  readAvailabilityAccessHint,
  readAvailabilityContext,
  writeAvailabilityAccessHint,
  writeAvailabilityContext,
} from '../../lib/availabilityContext';

export default function SchedulePage() {
  const { t } = useTranslation('msp/schedule');
  const searchParams = useSearchParams();
  const requestIdFromUrl = searchParams?.get('requestId') ?? null;

  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const [showAvailabilitySettings, setShowAvailabilitySettings] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [canConfigureAvailability, setCanConfigureAvailability] = useState(false);
  const [highlightedRequestId, setHighlightedRequestId] = useState<string | null>(null);
  const [headerActionsSlot, setHeaderActionsSlot] = useState<HTMLDivElement | null>(null);

  const fetchPendingCount = async () => {
    const result = await getAppointmentRequests({ status: 'pending' });
    if (result.success && result.data) {
      setPendingCount(result.data.length);
    }
  };

  // Transient failures (e.g. action calls interrupted mid-navigation) must not
  // permanently hide the Configure Availability button, so retry before giving up.
  const checkPermissions = async () => {
    const retryDelaysMs = [1000, 2500];
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await getAvailabilitySettingsAccess();
        if (result.success) {
          const canConfigure = Boolean(
            result.data?.canReadSystemSettings || result.data?.canManageUserHours
          );
          setCanConfigureAvailability(canConfigure);
          writeAvailabilityAccessHint(canConfigure);
          return;
        }
      } catch (error) {
        console.error('Failed to check availability access:', error);
      }
      if (attempt >= retryDelaysMs.length) {
        // Only a definitive answer may hide the button. Once the checks are
        // exhausted we keep this tab's last known-good access rather than
        // letting a network blip strip a permitted user of the entry point.
        setCanConfigureAvailability(readAvailabilityAccessHint());
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  };

  useEffect(() => {
    fetchPendingCount();
    checkPermissions();
  }, [refreshKey]);

  // Paint the button from this tab's remembered answer instead of waiting on the
  // bootstrap read; checkPermissions overwrites it either way. Applied on mount
  // rather than in the initial state so server and client markup still agree.
  useEffect(() => {
    if (readAvailabilityAccessHint()) {
      setCanConfigureAvailability(true);
    }
    // Reopen only after a refresh; on ordinary navigation the remembered scope
    // is applied when the reader opens the dialog themselves.
    if (readAvailabilityContext()?.isOpen && isReloadNavigation()) {
      setShowAvailabilitySettings(true);
    }
  }, []);

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
        <h1 className="text-2xl font-bold">
          {t('page.title', { defaultValue: 'Schedule' })}
        </h1>
        <div className="flex gap-2 items-center">
          {canConfigureAvailability && (
            <Button
              id="configure-availability-button"
              variant="outline"
              onClick={() => {
                setShowAvailabilitySettings(true);
                writeAvailabilityContext({ isOpen: true });
              }}
            >
              <Settings className="h-4 w-4 mr-2" />
              {t('page.actions.configureAvailability', {
                defaultValue: 'Configure Availability',
              })}
            </Button>
          )}
          <Button
            id="appointment-requests-button"
            variant="outline"
            onClick={() => setShowRequestsPanel(true)}
            className="relative"
          >
            <Calendar className="h-4 w-4 mr-2" />
            {t('page.actions.appointmentRequests', {
              defaultValue: 'Appointment Requests',
            })}
            {pendingCount > 0 && (
              <Badge variant="error" className="absolute -top-2 -right-2 px-2 py-0.5">
                {pendingCount}
              </Badge>
            )}
          </Button>
          {/* The calendar portals a w-9 share menu here after mount; reserving
              the width keeps the header buttons from shifting mid-click. */}
          <div ref={setHeaderActionsSlot} className="flex min-w-9 items-center justify-end" />
        </div>
      </div>
      <div className="h-[calc(100vh-120px)]">
        <ScheduleCalendar key={refreshKey} headerActionsSlot={headerActionsSlot} />
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
          onClose={() => {
            setShowAvailabilitySettings(false);
            writeAvailabilityContext({ isOpen: false });
          }}
        />
      )}
    </div>
  );
}
