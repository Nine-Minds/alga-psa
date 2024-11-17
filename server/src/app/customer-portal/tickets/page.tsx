'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { CustomTabs, TabContent } from '@/components/ui/CustomTabs';
import { Button } from '@/components/ui/Button';
import { Plus } from 'lucide-react';
import { TicketList } from '@/components/customer-portal/tickets/TicketList';
import { CreateTicketDialog } from '@/components/customer-portal/tickets/CreateTicketDialog';

export default function TicketsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('All Tickets');

  const tabs: TabContent[] = [
    { 
      label: 'All Tickets',
      content: <TicketList status="all" />
    },
    { 
      label: 'Open',
      content: <TicketList status="open" />
    },
    { 
      label: 'Closed',
      content: <TicketList status="closed" />
    },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Support Tickets</h1>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Ticket
        </Button>
      </div>

      <Card>
        <CustomTabs
          tabs={tabs}
          defaultTab={activeTab}
          onTabChange={(value: string) => setActiveTab(value)}
        />
      </Card>

      <CreateTicketDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
      />
    </div>
  );
}
