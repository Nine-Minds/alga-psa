'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { getTicketsForList } from '@alga-psa/tickets/actions/ticketActions';
import { ITicketListFilters, ITicketListItem } from '@alga-psa/types';
import TicketSelect, { TicketOption } from './TicketSelect';

interface PrefillFromTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrefill: (payload: { ticketId: string; shouldLink: boolean }) => void;
}

export default function PrefillFromTicketDialog({
  open,
  onOpenChange,
  onPrefill
}: PrefillFromTicketDialogProps): React.JSX.Element {
  const [tickets, setTickets] = useState<ITicketListItem[]>([]);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [shouldLink, setShouldLink] = useState(true);

  useEffect(() => {
    if (!open || ticketsLoaded) return;

    const fetchTickets = async () => {
      try {
        const filters: ITicketListFilters = { boardFilterState: 'all' };
        const results = await getTicketsForList(filters);
        setTickets(results || []);
        setTicketsLoaded(true);
      } catch (error) {
        console.error('Error fetching tickets for prefill:', error);
        setTickets([]);
      }
    };

    fetchTickets();
  }, [open, ticketsLoaded]);

  const options = useMemo<TicketOption[]>(() => {
    const searchTerms = searchValue.toLowerCase().split(' ').filter(Boolean);
    return tickets
      .filter(ticket => {
        if (searchTerms.length === 0) return true;
        const searchableText = `
          ${ticket.ticket_number}
          ${ticket.title}
          ${ticket.status_name || ''}
        `.toLowerCase();
        return searchTerms.every(term => searchableText.includes(term));
      })
      .map(ticket => ({
        value: ticket.ticket_id ?? '',
        label: `${ticket.ticket_number} - ${ticket.title}`,
        status: ticket.status_name || undefined
      }))
      .filter(option => option.value);
  }, [tickets, searchValue]);

  const handleConfirm = () => {
    if (!selectedTicketId) return;
    onPrefill({ ticketId: selectedTicketId, shouldLink });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Prefill From Ticket</DialogTitle>
        </DialogHeader>

        <TicketSelect
          options={options}
          value={selectedTicketId}
          onValueChange={setSelectedTicketId}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 mt-3">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={shouldLink}
            onChange={(event) => setShouldLink(event.target.checked)}
          />
          Link this ticket to the task
        </label>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!selectedTicketId}>
            Prefill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
