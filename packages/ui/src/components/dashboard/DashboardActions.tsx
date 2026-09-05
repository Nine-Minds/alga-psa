'use client';

import { Button } from '@alga-psa/ui/components/Button';

export function DashboardActions() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Button 
        id="create-ticket-button" 
        className="w-full font-medium"
        asChild
      >
        <a href="/client-portal/tickets/new">Create Support Ticket</a>
      </Button>
      <Button 
        id="view-invoice-button" 
        className="w-full font-medium"
        variant="soft" 
        asChild
      >
        <a href="/client-portal/billing/invoices">View Latest Invoice</a>
      </Button>
    </div>
  );
}
