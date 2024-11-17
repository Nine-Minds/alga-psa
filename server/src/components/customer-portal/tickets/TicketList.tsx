'use client';

import { useEffect, useState } from 'react';
import { DataTable } from '@/components/ui/DataTable';
import { formatDistanceToNow } from 'date-fns';
import { getClientTickets } from '@/lib/actions/client-tickets';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import { ITicketListItem } from '@/interfaces/ticket.interfaces';
import { TicketDetails } from './TicketDetails';

interface TicketListProps {
  status: string;
}

export function TicketList({ status }: TicketListProps) {
  const [tickets, setTickets] = useState<ITicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  useEffect(() => {
    const loadTickets = async () => {
      setLoading(true);
      try {
        const result = await getClientTickets(status);
        setTickets(result);
      } catch (error) {
        console.error('Failed to load tickets:', error);
      }
      setLoading(false);
    };

    loadTickets();
  }, [status]);

  const columns: ColumnDefinition<ITicketListItem>[] = [
    {
      title: 'Title',
      dataIndex: 'title',
      render: (value: string) => (
        <div className="font-medium">{value}</div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status_name',
      render: (value: string) => (
        <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          {value}
        </div>
      ),
    },
    {
      title: 'Priority',
      dataIndex: 'priority_name',
      render: (value: string) => (
        <div className="capitalize">{value}</div>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'entered_at',
      render: (value: string | null) => (
        <div className="text-sm text-gray-500">
          {value ? formatDistanceToNow(new Date(value), { addSuffix: true }) : '-'}
        </div>
      ),
    },
    {
      title: 'Last Updated',
      dataIndex: 'updated_at',
      render: (value: string | null) => (
        <div className="text-sm text-gray-500">
          {value ? formatDistanceToNow(new Date(value), { addSuffix: true }) : '-'}
        </div>
      ),
    },
  ];

  const handleRowClick = (ticket: ITicketListItem) => {
    if (ticket.ticket_id) {
      setSelectedTicketId(ticket.ticket_id);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <DataTable
        data={tickets}
        columns={columns}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={10}
        onRowClick={handleRowClick}
      />

      {selectedTicketId && (
        <TicketDetails
          ticketId={selectedTicketId}
          open={!!selectedTicketId}
          onClose={() => setSelectedTicketId(null)}
        />
      )}
    </div>
  );
}
