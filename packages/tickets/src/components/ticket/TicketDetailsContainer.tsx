'use client';

import React, { Suspense, useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  addTicketCommentWithCacheForCurrentUser,
  updateTicketWithCacheForCurrentUser,
} from '../../actions/optimizedTicketActions';
import TicketDetails from './TicketDetails';
import { TicketDetailsSkeleton } from './TicketDetailsSkeleton';
import { UnsavedChangesProvider } from '@alga-psa/ui/context';
import { persistTicketDescriptionUpdate } from './ticketDescriptionUpdate';

interface TicketDetailsContainerProps {
  ticketData: {
    ticket: any;
    bundle?: any;
    aggregatedChildClientComments?: any[];
    comments: any[];
    documents: any[];
    client: any;
    contacts: any[];
    contactInfo: any;
    createdByUser: any;
    board: any;
    additionalAgents: any[];
    availableAgents: any[];
    userMap: Record<
      string,
      {
        user_id: string;
        first_name: string;
        last_name: string;
        email?: string;
        user_type: string;
        avatarUrl: string | null;
      }
    >;
    contactMap?: Record<
      string,
      {
        contact_id: string;
        full_name: string;
        email?: string;
        avatarUrl: string | null;
      }
    >;
    options: {
      status: { value: string; label: string; is_closed?: boolean; board_id?: string | null }[];
      agent: { value: string; label: string }[];
      board: { value: string; label: string }[];
      priority: { value: string; label: string }[];
    };
    categories: any[];
    clients: any[];
    locations: any[];
    agentSchedules: any[];
  };
  surveySummaryCard?: React.ReactNode;
  associatedAssets?: React.ReactNode;
  renderContactDetails?: React.ComponentProps<typeof TicketDetails>['renderContactDetails'];
  renderCreateProjectTask?: React.ComponentProps<typeof TicketDetails>['renderCreateProjectTask'];
  renderClientDetails?: React.ComponentProps<typeof TicketDetails>['renderClientDetails'];
  renderIntervalManagement?: React.ComponentProps<typeof TicketDetails>['renderIntervalManagement'];
}

export default function TicketDetailsContainer({
  ticketData,
  surveySummaryCard,
  associatedAssets = null,
  renderContactDetails,
  renderCreateProjectTask,
  renderClientDetails,
  renderIntervalManagement,
}: TicketDetailsContainerProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { t } = useTranslation('features/tickets');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Local comments state to avoid mutating ticketData directly
  const [comments, setComments] = useState(ticketData.comments);

  // Sync comments with ticketData.comments when it changes
  useEffect(() => {
    setComments(ticketData.comments);
  }, [ticketData.comments]);

  // Track pending requests to avoid concurrent updates
  const pendingRequestRef = useRef<Promise<any> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Helper to queue requests
  const withSubmitting = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    // Wait for any pending request to complete
    if (pendingRequestRef.current) {
      await pendingRequestRef.current.catch(() => {});
    }

    setIsSubmitting(true);
    const promise = fn();
    pendingRequestRef.current = promise;

    try {
      const result = await promise;
      return result;
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
      pendingRequestRef.current = null;
    }
  }, []);

  const handleTicketUpdate = async (field: string, value: any) => {
    if (!session?.user) {
      toast.error(t('errors.authRequiredUpdate', 'You must be logged in to update tickets'));
      return;
    }

    try {
      setIsSubmitting(true);
      await updateTicketWithCacheForCurrentUser(ticketData.ticket.ticket_id, { [field]: value });
      toast.success(t('messages.ticketUpdated', 'Ticket updated successfully'));
    } catch (error) {
      handleError(error, t('errors.updateField', 'Failed to update {{field}}', { field }));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handler for batch ticket updates (used by Save Changes button)
  const handleBatchTicketUpdate = useCallback(async (changes: Record<string, unknown>): Promise<boolean> => {
    if (!session?.user) {
      toast.error(t('errors.authRequiredUpdate', 'You must be logged in to update tickets'));
      return false;
    }

    return withSubmitting(async () => {
      try {
        // Normalize assigned_to value
        const normalizedChanges = { ...changes };
        if ('assigned_to' in normalizedChanges) {
          const value = normalizedChanges.assigned_to;
          normalizedChanges.assigned_to = value && value !== 'unassigned' ? value : null;
        }

        await updateTicketWithCacheForCurrentUser(ticketData.ticket.ticket_id, normalizedChanges);
        toast.success(t('info.changesSaved', 'Changes saved successfully!'));

        // Refresh the page to get updated data
        router.refresh();

        return true;
      } catch (error) {
        handleError(error, t('errors.saveChanges', 'Failed to save changes'));
        return false;
      }
    });
  }, [router, session?.user, t, ticketData.ticket.ticket_id, withSubmitting]);

  const handleAddComment = async (content: string, isInternal: boolean, isResolution: boolean) => {
    if (!session?.user) {
      toast.error(t('errors.authRequiredComment', 'You must be logged in to add comments'));
      return;
    }

    try {
      setIsSubmitting(true);
      const newComment = await addTicketCommentWithCacheForCurrentUser(
        ticketData.ticket.ticket_id,
        content,
        isInternal,
        isResolution
      );

      setComments(prev => [...prev, newComment]);
      toast.success(t('messages.commentAdded', 'Comment added successfully'));
    } catch (error) {
      handleError(error, t('errors.addComment', 'Failed to add comment'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateDescription = async (content: string) => {
    return persistTicketDescriptionUpdate({
      sessionUser: session?.user,
      ticketId: ticketData.ticket.ticket_id,
      currentAttributes: ticketData.ticket.attributes,
      content,
      setSubmitting: setIsSubmitting,
      updateTicket: updateTicketWithCacheForCurrentUser,
      toastApi: toast,
      handleError,
    });
  };

  return (
    <UnsavedChangesProvider>
      <div className="bg-gray-100 dark:bg-gray-900 min-h-screen p-4">
        <Suspense fallback={<TicketDetailsSkeleton />}>
        <TicketDetails
          initialTicket={ticketData.ticket}
            initialBundle={ticketData.bundle}
            aggregatedChildClientComments={ticketData.aggregatedChildClientComments || []}
            onClose={() => router.back()}
            initialComments={comments}
            initialDocuments={ticketData.documents}
            initialClient={ticketData.client}
            initialContacts={ticketData.contacts}
            initialContactInfo={ticketData.contactInfo}
            initialCreatedByUser={ticketData.createdByUser}
            initialBoard={ticketData.board}
            initialAdditionalAgents={ticketData.additionalAgents}
            initialAvailableAgents={ticketData.availableAgents}
            initialUserMap={ticketData.userMap}
            initialContactMap={ticketData.contactMap || {}}
            statusOptions={ticketData.options.status}
            agentOptions={ticketData.options.agent}
            boardOptions={ticketData.options.board}
            priorityOptions={ticketData.options.priority}
            initialCategories={ticketData.categories}
            initialClients={ticketData.clients}
            initialLocations={ticketData.locations}
            initialAgentSchedules={ticketData.agentSchedules}
            onTicketUpdate={handleTicketUpdate}
            onBatchTicketUpdate={handleBatchTicketUpdate}
            onAddComment={handleAddComment}
            onUpdateDescription={handleUpdateDescription}
            isSubmitting={isSubmitting}
          surveySummaryCard={surveySummaryCard}
          associatedAssets={associatedAssets}
          renderContactDetails={renderContactDetails}
          renderCreateProjectTask={renderCreateProjectTask}
            renderClientDetails={renderClientDetails}
            renderIntervalManagement={renderIntervalManagement}
        />
        </Suspense>
      </div>
    </UnsavedChangesProvider>
  );
}
