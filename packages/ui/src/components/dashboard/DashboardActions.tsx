'use client';

import { Button } from '../Button';

export function DashboardActions() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Button 
        id="create-ticket-button" 
        className="w-full bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))] text-white font-medium" 
        asChild
      >
        <a href="/client-portal/tickets/new">Create Support Ticket</a>
      </Button>
      <Button 
        id="view-invoice-button" 
        className="w-full bg-[rgb(var(--color-primary-50))] hover:bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-700))] font-medium" 
        variant="soft" 
        asChild
      >
        <a href="/client-portal/billing/invoices">View Latest Invoice</a>
      </Button>
    </div>
  );
}
