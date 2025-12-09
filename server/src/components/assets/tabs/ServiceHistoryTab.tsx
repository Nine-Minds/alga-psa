import React, { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Badge, Button } from '@mantine/core';
import { Ticket } from 'lucide-react';
import { getAssetLinkedTickets } from '../../../lib/actions/asset-actions/assetActions';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';
import { Asset } from '../../../interfaces/asset.interfaces';
import { QuickAddTicket } from '../../tickets/QuickAddTicket';

interface ServiceHistoryTabProps {
  asset: Asset;
}

export const ServiceHistoryTab: React.FC<ServiceHistoryTabProps> = ({ asset }) => {
  const [isTicketDialogOpen, setIsTicketDialogOpen] = useState(false);
  const { mutate } = useSWRConfig();
  
  const { data: tickets, isLoading } = useSWR(
    asset.asset_id ? ['asset', asset.asset_id, 'tickets'] : null,
    ([_, id]) => getAssetLinkedTickets(id)
  );

  const handleTicketAdded = () => {
    mutate(['asset', asset.asset_id, 'tickets']);
  };

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base font-semibold">Service History</CardTitle>
          <Button 
            id="create-ticket-btn"
            leftSection={<Ticket size={16} />} 
            size="xs"
            onClick={() => setIsTicketDialogOpen(true)}
          >
            Create Ticket
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket ID</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Date Linked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets && tickets.length > 0 ? (
                  tickets.map((ticket) => (
                    <TableRow key={ticket.ticket_id}>
                      <TableCell className="font-medium text-primary-600">
                        #{ticket.ticket_id.substring(0, 8)}
                      </TableCell>
                      <TableCell>{ticket.title}</TableCell>
                      <TableCell>
                        <Badge variant="light" color="gray">{ticket.status_name}</Badge>
                      </TableCell>
                      <TableCell>
                        {ticket.priority_name && <Badge variant="dot" color="blue">{ticket.priority_name}</Badge>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(new Date(ticket.linked_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No tickets linked to this asset.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <QuickAddTicket
        open={isTicketDialogOpen}
        onOpenChange={setIsTicketDialogOpen}
        onTicketAdded={handleTicketAdded}
        prefilledClient={asset.client_id ? {
          id: asset.client_id,
          name: asset.client?.client_name || 'Unknown Client'
        } : undefined}
        assetId={asset.asset_id}
      />
    </>
  );
};