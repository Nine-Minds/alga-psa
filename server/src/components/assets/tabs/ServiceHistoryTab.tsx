import React from 'react';
import useSWR from 'swr';
import { Table } from '../../ui/Table'; // Verify path
import { Card } from 'server/src/components/ui/Card';
import { Badge, Button, Group, Text, Pagination } from '@mantine/core';
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

  const columns = [
    { header: 'Ticket ID', accessorKey: 'ticket_id' },
    { header: 'Subject', accessorKey: 'title' },
    { header: 'Status', accessorKey: 'status_name' },
    { header: 'Priority', accessorKey: 'priority_name' },
    { header: 'Date Linked', accessorKey: 'linked_at' },
  ];

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
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Ticket ID</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Date Linked</th>
            </tr>
          </thead>
          <tbody>
            {tickets && tickets.length > 0 ? (
              tickets.map((ticket) => (
                <tr key={ticket.ticket_id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium text-primary-600">
                    #{ticket.ticket_id.substring(0, 8)}
                  </td>
                  <td className="px-4 py-3">{ticket.title}</td>
                  <td className="px-4 py-3">
                    <Badge variant="light" color="gray">{ticket.status_name}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {ticket.priority_name && <Badge variant="dot" color="blue">{ticket.priority_name}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDateTime(new Date(ticket.linked_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No tickets linked to this asset.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};