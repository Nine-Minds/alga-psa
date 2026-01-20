'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

interface TicketMaterialsCardProps {
  ticketId: string;
  clientId?: string | null;
  currencyCode?: string | null;
}

export default function TicketMaterialsCard({ ticketId }: TicketMaterialsCardProps) {
  return (
    <div className="mt-4">
      <Alert>
        <AlertDescription>
          Ticket materials are now owned by Billing. (ticketId: {ticketId})
        </AlertDescription>
      </Alert>
    </div>
  );
}

