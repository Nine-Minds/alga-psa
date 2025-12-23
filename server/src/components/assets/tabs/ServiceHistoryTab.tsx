import React, { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Ticket } from 'lucide-react';
import { getAssetLinkedTickets } from '../../../lib/actions/asset-actions/assetActions';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';
import { Asset } from '../../../interfaces/asset.interfaces';
import { QuickAddTicket } from '../../tickets/QuickAddTicket';
import { cn } from 'server/src/lib/utils';

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
            size="xs"
            onClick={() => setIsTicketDialogOpen(true)}
            className="flex items-center gap-2"
          >
            <Ticket size={16} />
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
                      <TableCell className="text-gray-900">{ticket.title}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-gray-100 text-gray-700 border-gray-200">
                          {ticket.status_name}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {ticket.priority_name && (
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-primary-500" />
                            <span className="text-xs font-medium text-gray-700">{ticket.priority_name}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-gray-500">
                        {formatDateTime(new Date(ticket.linked_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-gray-400">
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