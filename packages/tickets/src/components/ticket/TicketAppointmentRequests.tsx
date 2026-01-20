'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

interface TicketAppointmentRequestsProps {
  ticketId: string;
}

export default function TicketAppointmentRequests({ ticketId }: TicketAppointmentRequestsProps) {
  return (
    <div className="mt-4">
      <Alert>
        <AlertDescription>
          Appointment requests are now managed in Scheduling. (ticketId: {ticketId})
        </AlertDescription>
      </Alert>
    </div>
  );
}

