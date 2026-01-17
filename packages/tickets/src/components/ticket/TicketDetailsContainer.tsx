'use client';

import React, { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import {
  addTicketCommentWithCacheForCurrentUser,
  updateTicketWithCacheForCurrentUser,
} from '../../actions/optimizedTicketActions';
import TicketDetails from './TicketDetails';
import { TicketDetailsSkeleton } from './TicketDetailsSkeleton';
import type { SurveyTicketSatisfactionSummary } from '@alga-psa/types';

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

  const handleTicketUpdate = async (field: string, value: any) => {
    if (!session?.user) {
      toast.error('You must be logged in to update tickets');
      return;
    }

    try {
      setIsSubmitting(true);
      await updateTicketWithCacheForCurrentUser(ticketData.ticket.ticket_id, { [field]: value });
      toast.success(`${field} updated successfully`);
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
      toast.error(`Failed to update ${field}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddComment = async (content: string, isInternal: boolean, isResolution: boolean) => {
    if (!session?.user) {
      toast.error('You must be logged in to add comments');
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

      ticketData.comments.push(newComment);
      toast.success('Comment added successfully');
    } catch (error) {
      console.error('Error adding comment:', error);
      toast.error('Failed to add comment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateDescription = async (content: string) => {
    if (!session?.user) {
      toast.error('You must be logged in to update the description');
      return false;
    }

    try {
      setIsSubmitting(true);

      const currentAttributes = ticketData.ticket.attributes || {};
      const updatedAttributes = {
        ...currentAttributes,
        description: content,
      };
      await updateTicketWithCacheForCurrentUser(ticketData.ticket.ticket_id, {
        attributes: updatedAttributes,
        updated_at: new Date().toISOString(),
      });

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

  return (
    <div className="bg-gray-100 min-h-screen p-4">
      <Suspense fallback={<TicketDetailsSkeleton />}>
        <TicketDetails
          initialTicket={ticketData.ticket}
          initialBundle={ticketData.bundle}
          aggregatedChildClientComments={ticketData.aggregatedChildClientComments || []}
          onClose={() => router.back()}
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
