'use client';

import React, { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import TicketDetails from 'server/src/components/tickets/TicketDetails';
import { updateTicketWithCache, addTicketCommentWithCache } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { TicketDetailsSkeleton } from 'server/src/components/tickets/TicketDetailsSkeleton';

// Define the props interface based on the consolidated data structure
interface TicketDetailsContainerProps {
  ticketData: {
    ticket: any;
    comments: any[];
    documents: any[];
    company: any;
    contacts: any[];
    contactInfo: any;
    createdByUser: any;
    channel: any;
    additionalAgents: any[];
    availableAgents: any[];
    userMap: Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string }>;
    options: {
      status: { value: string; label: string }[];
      agent: { value: string; label: string }[];
      channel: { value: string; label: string }[];
      priority: { value: string; label: string }[];
    };
    categories: any[];
    companies: any[];
    agentSchedules: any[];
  };
}


export default function TicketDetailsContainer({ ticketData }: TicketDetailsContainerProps) {
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
      
      await addTicketCommentWithCache(
        ticketData.ticket.ticket_id,
        content,
        isInternal,
        isResolution,
        false, // not initial description
        currentUser
      );
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

      // Also update the initial description comment if it exists
      const initialComment = ticketData.comments.find(comment => comment.is_initial_description);
      if (initialComment?.comment_id) {
        await addTicketCommentWithCache(
          ticketData.ticket.ticket_id,
          content,
          false, // not internal
          false, // not resolution
          true,  // is initial description
          currentUser
        );
      }

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

  // Create separate components for each section to enable independent suspense boundaries
  const TicketInfoSection = () => (
    <Suspense fallback={<div id="ticket-info-loading-skeleton" className="animate-pulse bg-gray-200 h-64 rounded-lg mb-6"></div>}>
      <TicketDetails
        id="ticket-details-component"
        initialTicket={ticketData.ticket}
        onClose={() => router.back()}
        // Pass pre-fetched data as props
        initialComments={ticketData.comments}
        initialDocuments={ticketData.documents}
        initialCompany={ticketData.company}
        initialContacts={ticketData.contacts}
        initialContactInfo={ticketData.contactInfo}
        initialCreatedByUser={ticketData.createdByUser}
        initialChannel={ticketData.channel}
        initialAdditionalAgents={ticketData.additionalAgents}
        initialAvailableAgents={ticketData.availableAgents}
        initialUserMap={ticketData.userMap}
        statusOptions={ticketData.options.status}
        agentOptions={ticketData.options.agent}
        channelOptions={ticketData.options.channel}
        priorityOptions={ticketData.options.priority}
        initialCategories={ticketData.categories}
        initialCompanies={ticketData.companies}
        initialAgentSchedules={ticketData.agentSchedules}
        // Pass optimized handlers
        onTicketUpdate={handleTicketUpdate}
        onAddComment={handleAddComment}
        onUpdateDescription={handleUpdateDescription}
        isSubmitting={isSubmitting}
      />
    </Suspense>
  );

  return <div id="ticket-details-container-wrapper"><TicketInfoSection /></div>;
}