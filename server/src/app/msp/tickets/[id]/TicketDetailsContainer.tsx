'use client';

import React, { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails';
import { updateTicketWithCache, addTicketCommentWithCache } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { TicketDetailsSkeleton } from '@alga-psa/tickets/components/ticket/TicketDetailsSkeleton';
import type { SurveyTicketSatisfactionSummary } from 'server/src/interfaces/survey.interface';

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

  // Handle ticket updates using the optimized server action
  const handleTicketUpdate = async (field: string, value: any) => {
    if (!session?.user) {
      toast.error('You must be logged in to update tickets');
      return;
    }

    try {
      setIsSubmitting(true);
      
      // Get the current user from the database
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        toast.error('Failed to get current user');
        return;
      }
      
      await updateTicketWithCache(
        ticketData.ticket.ticket_id,
        { [field]: value },
        currentUser
      );
      toast.success(`${field} updated successfully`);
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
      toast.error(`Failed to update ${field}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle adding comments using the optimized server action
  const handleAddComment = async (content: string, isInternal: boolean, isResolution: boolean) => {
    if (!session?.user) {
      toast.error('You must be logged in to add comments');
      return;
    }

    try {
      setIsSubmitting(true);
      
      // Get the current user from the database
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        toast.error('Failed to get current user');
        return;
      }
      
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
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle updating description using the optimized server action
  const handleUpdateDescription = async (content: string) => {
    if (!session?.user) {
      toast.error('You must be logged in to update the description');
      return false;
    }

    try {
      setIsSubmitting(true);
      
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
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render directly to avoid redefining a component each render,
  // which can cause unmount/mount cycles and side-effects
  return (
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
          onAddComment={handleAddComment}
          onUpdateDescription={handleUpdateDescription}
          isSubmitting={isSubmitting}
          surveySummary={surveySummary}
        />
      </Suspense>
    </div>
  );
}
