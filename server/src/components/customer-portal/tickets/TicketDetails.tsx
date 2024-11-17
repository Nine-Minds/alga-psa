'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/Button';
import { X } from 'lucide-react';
import { getClientTicketDetails } from '@/lib/actions/client-tickets';
import { formatDistanceToNow } from 'date-fns';
import { ITicket } from '@/interfaces/ticket.interfaces';

interface TicketDetailsProps {
  ticketId: string;
  open: boolean;
  onClose: () => void;
}

interface TicketWithDetails extends ITicket {
  status_name?: string;
  priority_name?: string;
}

export function TicketDetails({ ticketId, open, onClose }: TicketDetailsProps) {
  const [ticket, setTicket] = useState<TicketWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTicketDetails = async () => {
      if (!open) return;
      
      setLoading(true);
      setError(null);
      try {
        const details = await getClientTicketDetails(ticketId);
        setTicket(details);
      } catch (err) {
        setError('Failed to load ticket details');
        console.error(err);
      }
      setLoading(false);
    };

    loadTicketDetails();
  }, [ticketId, open]);

  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[600px] max-h-[80vh] overflow-y-auto animate-scale-in">
          <Dialog.Title className="text-xl font-bold mb-4">
            {loading ? 'Loading...' : ticket?.title}
          </Dialog.Title>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {!loading && ticket && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {ticket.status_name || 'Unknown Status'}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {ticket.priority_name || 'Unknown Priority'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    Ticket #{ticket.ticket_number}
                  </p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <p>Created {formatDistanceToNow(new Date(ticket.entered_at || ''), { addSuffix: true })}</p>
                  {ticket.updated_at && (
                    <p>Updated {formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })}</p>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-2">Description</h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {(ticket.attributes?.description as string) || 'No description provided'}
                </p>
              </div>
            </div>
          )}

          <Dialog.Close>
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-4 right-4 p-0 w-6 h-6 flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
