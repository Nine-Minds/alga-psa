import React, { useState, useCallback } from 'react';
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
import { useDrawer } from 'server/src/context/DrawerContext';
import { getConsolidatedTicketData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import TicketDetails from 'server/src/components/tickets/ticket/TicketDetails';
import { toast } from 'react-hot-toast';

interface ServiceHistoryTabProps {
  asset: Asset;
}

export const ServiceHistoryTab: React.FC<ServiceHistoryTabProps> = ({ asset }) => {
  const [isTicketDialogOpen, setIsTicketDialogOpen] = useState(false);
  const { mutate } = useSWRConfig();
  const { openDrawer } = useDrawer();
  
  const { data: tickets, isLoading } = useSWR(
    asset.asset_id ? ['asset', asset.asset_id, 'tickets'] : null,
    ([_, id]) => getAssetLinkedTickets(id)
  );

  const handleTicketAdded = () => {
    mutate(['asset', asset.asset_id, 'tickets']);
  };

  const handleTicketClick = useCallback(async (ticketId: string) => {
    try {
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        toast.error('User not authenticated');
        return;
      }

      const ticketData = await getConsolidatedTicketData(ticketId);
      
      if (!ticketData) {
        toast.error('Failed to load ticket');
        return;
      }

      openDrawer(
        <TicketDetails
          isInDrawer={true}
          initialTicket={ticketData.ticket}
          initialComments={ticketData.comments}
          initialBoard={ticketData.board}
          initialClient={ticketData.client}
          initialContactInfo={ticketData.contactInfo}
          initialCreatedByUser={ticketData.createdByUser}
          initialAdditionalAgents={ticketData.additionalAgents}
          initialAvailableAgents={ticketData.availableAgents}
          initialUserMap={ticketData.userMap}
          statusOptions={ticketData.options.status}
          agentOptions={ticketData.options.agent}
          boardOptions={ticketData.options.board}
          priorityOptions={ticketData.options.priority}
          initialCategories={ticketData.categories}
          initialClients={ticketData.clients}
          initialLocations={ticketData.locations}
          currentUser={currentUser}
        />,
        undefined,
        undefined,
        '50vw'
      );
    } catch (error) {
      console.error('Error opening ticket:', error);
      toast.error('Failed to open ticket');
    }
  }, [openDrawer]);

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
                      <TableCell 
                        className="font-medium text-primary-600 cursor-pointer hover:text-primary-700 hover:underline"
                        onClick={() => handleTicketClick(ticket.ticket_id)}
                      >
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