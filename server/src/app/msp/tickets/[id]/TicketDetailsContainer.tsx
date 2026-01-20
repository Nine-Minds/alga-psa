'use client';

import React, { useState, useRef, useCallback, Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TicketDetails from 'server/src/components/tickets/ticket/TicketDetails';
import { updateTicketWithCache, addTicketCommentWithCache } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import type { SurveyTicketSatisfactionSummary } from 'server/src/interfaces/survey.interface';
import { UnsavedChangesProvider } from 'server/src/contexts/UnsavedChangesContext';
import type { IComment } from 'server/src/interfaces/comment.interface';

// Define the props interface based on the consolidated data structure
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
    userMap: Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string, avatarUrl: string | null }>;
    options: {
      status: { value: string; label: string }[];
      agent: { value: string; label: string }[];
      board: { value: string; label: string }[];
      priority: { value: string; label: string }[];
    };
    categories: any[];
    clients: any[];
    locations: any[];
    agentSchedules: any[];
  };
  surveySummary?: SurveyTicketSatisfactionSummary | null;
}


// Helper to extract error message from unknown error
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

// Helper to check if error is a concurrency conflict
const isConflictError = (error: unknown): boolean => {
  const message = getErrorMessage(error);
  return message.includes('CONFLICT:');
};

export default function TicketDetailsContainer({ ticketData, surveySummary = null }: TicketDetailsContainerProps) {
  const router = useRouter();
  const { data: session } = useSession();

  // Use a counter to track concurrent requests - prevents race condition
  // where isSubmitting could be set to false while another request is still pending
  const pendingRequestsRef = useRef(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // Local state for comments to avoid mutating props (which doesn't trigger re-renders)
  const [comments, setComments] = useState<IComment[]>(ticketData.comments);

  // Track the expected updated_at for optimistic concurrency control
  // This is set when the ticket is loaded and updated after each successful save
  const expectedUpdatedAtRef = useRef<string | undefined>(ticketData.ticket.updated_at);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Helper to wrap async operations with isSubmitting state management
  // Uses a counter to handle concurrent requests properly
  // Checks isMountedRef to prevent state updates after unmount
  const withSubmitting = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    pendingRequestsRef.current++;
    if (isMountedRef.current) {
      setIsSubmitting(true);
    }
    try {
      return await operation();
    } finally {
      pendingRequestsRef.current--;
      // Only set to false when ALL pending requests are complete and still mounted
      if (pendingRequestsRef.current === 0 && isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, []);

  // Handle single field ticket updates using the optimized server action
  // Note: Server actions now get user from session internally for security
  const handleTicketUpdate = useCallback(async (field: string, value: any): Promise<void> => {
    if (!session?.user) {
      toast.error('You must be logged in to update tickets');
      return;
    }

    return withSubmitting(async () => {
      try {
        await updateTicketWithCache(
          ticketData.ticket.ticket_id,
          { [field]: value },
          undefined, // user is now fetched internally by server action
          expectedUpdatedAtRef.current // Pass expected updated_at for optimistic concurrency
        );
        // Update expected updated_at after successful save
        expectedUpdatedAtRef.current = new Date().toISOString();
        toast.success(`${field} updated successfully`);
      } catch (error) {
        console.error(`Error updating ${field}:`, error);
        if (isConflictError(error)) {
          toast.error('This ticket was modified by another user. Please refresh the page to see the latest changes.');
        } else {
          toast.error(`Failed to update ${field}: ${getErrorMessage(error)}`);
        }
      }
    });
  }, [session?.user, withSubmitting, ticketData.ticket.ticket_id]);

  // Handle batch ticket updates - saves all changes atomically to avoid partial updates
  // Note: Server actions now get user from session internally for security
  const handleBatchTicketUpdate = useCallback(async (changes: Record<string, any>): Promise<boolean> => {
    // Check login first before any other logic
    if (!session?.user) {
      toast.error('You must be logged in to update tickets');
      return false;
    }

    // Early return if no changes - this is after login check so we know user is authenticated
    if (!changes || Object.keys(changes).length === 0) {
      return true;
    }

    return withSubmitting(async () => {
      try {
        // Save all changes in a single API call - this ensures atomicity
        await updateTicketWithCache(
          ticketData.ticket.ticket_id,
          changes,
          undefined, // user is now fetched internally by server action
          expectedUpdatedAtRef.current // Pass expected updated_at for optimistic concurrency
        );

        // Update expected updated_at after successful save
        expectedUpdatedAtRef.current = new Date().toISOString();
        toast.success('Changes saved successfully');
        return true;
      } catch (error) {
        console.error('Error saving changes:', error);
        if (isConflictError(error)) {
          toast.error('This ticket was modified by another user. Please refresh the page to see the latest changes.');
        } else {
          toast.error(`Failed to save changes: ${getErrorMessage(error)}`);
        }
        return false;
      }
    });
  }, [session?.user, withSubmitting, ticketData.ticket.ticket_id]);

  // Handle adding comments using the optimized server action
  // Note: Server actions now get user from session internally for security
  const handleAddComment = useCallback(async (content: string, isInternal: boolean, isResolution: boolean): Promise<void> => {
    if (!session?.user) {
      toast.error('You must be logged in to add comments');
      return;
    }

    return withSubmitting(async () => {
      try {
        const newComment = await addTicketCommentWithCache(
          ticketData.ticket.ticket_id,
          content,
          isInternal,
          isResolution
          // user is now fetched internally by server action
        );

        // Update local state to trigger re-render (not mutating props)
        if (isMountedRef.current) {
          setComments(prev => [...prev, newComment]);
        }

        toast.success('Comment added successfully');
      } catch (error) {
        console.error('Error adding comment:', error);
        toast.error(`Failed to add comment: ${getErrorMessage(error)}`);
      }
    });
  }, [session?.user, withSubmitting, ticketData.ticket.ticket_id]);

  // Handle updating description using the optimized server action
  // Note: Server actions now get user from session internally for security
  const handleUpdateDescription = useCallback(async (content: string): Promise<boolean> => {
    if (!session?.user) {
      toast.error('You must be logged in to update the description');
      return false;
    }

    return withSubmitting(async () => {
      // Update the ticket's attributes.description field
      const currentAttributes = ticketData.ticket.attributes || {};
      const updatedAttributes = {
        ...currentAttributes,
        description: content
      };

      try {
        await updateTicketWithCache(
          ticketData.ticket.ticket_id,
          {
            attributes: updatedAttributes
          },
          undefined, // user is now fetched internally by server action
          expectedUpdatedAtRef.current // Pass expected updated_at for optimistic concurrency
        );

        // Update expected updated_at after successful save
        expectedUpdatedAtRef.current = new Date().toISOString();
        toast.success('Description updated successfully');
        return true;
      } catch (error) {
        console.error('Error updating description:', error);
        if (isConflictError(error)) {
          toast.error('This ticket was modified by another user. Please refresh the page to see the latest changes.');
        } else {
          toast.error(`Failed to update description: ${getErrorMessage(error)}`);
        }
        return false;
      }
    });
  }, [session?.user, withSubmitting, ticketData.ticket.ticket_id, ticketData.ticket.attributes]);

  // Render directly to avoid redefining a component each render,
  // which can cause unmount/mount cycles and side-effects
  return (
    <UnsavedChangesProvider
      dialogTitle="Unsaved Changes"
      dialogMessage="You have unsaved changes to this ticket. Are you sure you want to leave? Your changes will be lost."
    >
      <div id="ticket-details-container-wrapper">
        <Suspense fallback={<div id="ticket-info-loading-skeleton" className="animate-pulse bg-gray-200 h-64 rounded-lg mb-6"></div>}>
          <TicketDetails
            id="ticket-details-component"
            initialTicket={ticketData.ticket}
            initialBundle={ticketData.bundle}
            aggregatedChildClientComments={ticketData.aggregatedChildClientComments || []}
            onClose={() => router.back()}
            // Pass pre-fetched data as props
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
            statusOptions={ticketData.options.status}
            agentOptions={ticketData.options.agent}
            boardOptions={ticketData.options.board}
            priorityOptions={ticketData.options.priority}
            initialCategories={ticketData.categories}
            initialClients={ticketData.clients}
            initialLocations={ticketData.locations}
            initialAgentSchedules={ticketData.agentSchedules}
            // Pass optimized handlers
            onTicketUpdate={handleTicketUpdate}
            onBatchTicketUpdate={handleBatchTicketUpdate}
            onAddComment={handleAddComment}
            onUpdateDescription={handleUpdateDescription}
            isSubmitting={isSubmitting}
            surveySummary={surveySummary}
          />
        </Suspense>
      </div>
    </UnsavedChangesProvider>
  );
}
