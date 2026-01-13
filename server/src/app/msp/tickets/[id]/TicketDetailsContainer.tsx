'use client';

import React, { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import TicketDetails from 'server/src/components/tickets/ticket/TicketDetails';
import { updateTicketWithCache, addTicketCommentWithCache } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { TicketDetailsSkeleton } from 'server/src/components/tickets/ticket/TicketDetailsSkeleton';
import type { SurveyTicketSatisfactionSummary } from 'server/src/interfaces/survey.interface';
import { UnsavedChangesProvider } from 'server/src/contexts/UnsavedChangesContext';

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


export default function TicketDetailsContainer({ ticketData, surveySummary = null }: TicketDetailsContainerProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Helper to wrap async operations with isSubmitting state management
  // This avoids duplicating setIsSubmitting(true)/finally/setIsSubmitting(false) logic
  const withSubmitting = async <T,>(operation: () => Promise<T>): Promise<T> => {
    setIsSubmitting(true);
    try {
      return await operation();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle single field ticket updates using the optimized server action
  const handleTicketUpdate = async (field: string, value: any) => {
    if (!session?.user) {
      toast.error('You must be logged in to update tickets');
      return;
    }

    await withSubmitting(async () => {
      // Get the current user from the database
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        toast.error('Failed to get current user');
        return;
      }

      try {
        await updateTicketWithCache(
          ticketData.ticket.ticket_id,
          { [field]: value },
          currentUser
        );
        toast.success(`${field} updated successfully`);
      } catch (error) {
        console.error(`Error updating ${field}:`, error);
        toast.error(`Failed to update ${field}`);
      }
    });
  };

  // Handle batch ticket updates - saves all changes atomically to avoid partial updates
  const handleBatchTicketUpdate = async (changes: Record<string, any>): Promise<boolean> => {
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
      // Get the current user from the database
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        toast.error('Failed to get current user');
        return false;
      }

      try {
        // Save all changes in a single API call - this ensures atomicity
        await updateTicketWithCache(
          ticketData.ticket.ticket_id,
          changes,
          currentUser
        );

        toast.success('Changes saved successfully');
        return true;
      } catch (error) {
        console.error('Error saving changes:', error);
        toast.error('Failed to save changes');
        return false;
      }
    });
  };

  // Handle adding comments using the optimized server action
  const handleAddComment = async (content: string, isInternal: boolean, isResolution: boolean) => {
    if (!session?.user) {
      toast.error('You must be logged in to add comments');
      return;
    }

    await withSubmitting(async () => {
      // Get the current user from the database
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        toast.error('Failed to get current user');
        return;
      }

      try {
        const newComment = await addTicketCommentWithCache(
          ticketData.ticket.ticket_id,
          content,
          isInternal,
          isResolution,
          currentUser
        );

        // Update the local state with the new comment
        ticketData.comments.push(newComment);

        toast.success('Comment added successfully');
      } catch (error) {
        console.error('Error adding comment:', error);
        toast.error('Failed to add comment');
      }
    });
  };

  // Handle updating description using the optimized server action
  const handleUpdateDescription = async (content: string) => {
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

      // Get the current user from the database
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        toast.error('Failed to get current user');
        return false;
      }

      try {
        await updateTicketWithCache(
          ticketData.ticket.ticket_id,
          {
            attributes: updatedAttributes,
            updated_by: currentUser.user_id,
            updated_at: new Date().toISOString()
          },
          currentUser
        );

        toast.success('Description updated successfully');
        return true;
      } catch (error) {
        console.error('Error updating description:', error);
        toast.error('Failed to update description');
        return false;
      }
    });
  };

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
