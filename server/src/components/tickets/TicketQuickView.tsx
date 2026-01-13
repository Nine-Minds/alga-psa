'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getConsolidatedTicketData } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import TicketDetails from 'server/src/components/tickets/ticket/TicketDetails';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

interface TicketQuickViewProps {
  ticketId: string;
  onClose?: () => void;
}

export const TicketQuickView: React.FC<TicketQuickViewProps> = ({ ticketId, onClose }) => {
  const [ticketData, setTicketData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    const fetchTicket = async () => {
      setLoading(true);
      setError(null);
      try {
        const user = await getCurrentUser();
        if (!user) {
          setError('User not authenticated');
          return;
        }

        const data = await getConsolidatedTicketData(ticketId, user);
        if (!data || !data.ticket) {
          setError('Ticket not found');
        } else {
          setTicketData(data);
        }
      } catch (err) {
        console.error('Error fetching ticket for quick view:', err);
        setError('Failed to load ticket details');
      } finally {
        setLoading(false);
      }
    };

    fetchTicket();
  }, [ticketId]);

  const handleUnsavedChanges = useCallback((hasChanges: boolean) => {
    setHasUnsavedChanges(hasChanges);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (error || !ticketData) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{error || 'Something went wrong'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <TicketDetails
      id="ticket-quick-view-details"
      initialTicket={ticketData.ticket}
      initialBundle={ticketData.bundle}
      aggregatedChildClientComments={ticketData.aggregatedChildClientComments || []}
      onClose={onClose}
      isInDrawer={true}
      quickView={true}
      onHasUnsavedChanges={handleUnsavedChanges}
      initialComments={ticketData.comments}
      initialDocuments={ticketData.documents}
      initialClient={ticketData.client}
      initialContacts={ticketData.contacts}
      initialContactInfo={ticketData.contactInfo}
      initialCreatedByUser={ticketData.createdByUser}
      initialBoard={ticketData.board}
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
      initialAgentSchedules={ticketData.agentSchedules}
    />
  );
};

export default TicketQuickView;
