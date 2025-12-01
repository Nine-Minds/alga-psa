import React from 'react';
import useSWR from 'swr';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { Card } from 'server/src/components/ui/Card';
import { Badge, Button } from '@mantine/core';
import { Ticket } from 'lucide-react';
import { getAssetLinkedTickets } from '../../../lib/actions/asset-actions/assetActions';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';

interface ServiceHistoryTabProps {
  assetId: string;
}

export const ServiceHistoryTab: React.FC<ServiceHistoryTabProps> = ({ assetId }) => {
  const { data: tickets, isLoading } = useSWR(
    assetId ? ['asset', assetId, 'tickets'] : null,
    ([_, id]) => getAssetLinkedTickets(id)
  );

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  return (
    <Card 
      title="Service History"
      action={
        <Button leftSection={<Ticket size={16} />} size="xs">
          Create Ticket
        </Button>
      }
    >
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
    </Card>
  );
};