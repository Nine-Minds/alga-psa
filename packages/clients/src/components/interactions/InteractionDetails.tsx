// src/components/interactions/InteractionDetails.tsx

'use client';

import React, { useState, useEffect } from 'react';
import type { IInteraction, ITicket, IWorkItem, WorkItemType } from '@alga-psa/types';
import { Clock, FileText, ArrowLeft, Plus, Pen, Trash2 } from 'lucide-react';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { ButtonComponent, ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import { useDrawer } from "@alga-psa/ui";
import ContactDetailsView from '@alga-psa/clients/components/contacts/ContactDetailsView';
import ClientDetails from '@alga-psa/clients/components/clients/ClientDetails';
import AgentScheduleDrawer from '@alga-psa/tickets/components/ticket/AgentScheduleDrawer';
import { Button } from '@alga-psa/ui/components/Button';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import { QuickAddInteraction } from '@alga-psa/clients/components/interactions/QuickAddInteraction';
import { getContactByContactNameId } from '@alga-psa/clients/actions';
import { getClientById, getAllClients } from '@alga-psa/clients/actions';
import { deleteInteraction } from '@alga-psa/clients/actions';
import { Text, Flex, Heading } from '@radix-ui/themes';
import { RichTextViewer } from '@alga-psa/ui/editor';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';
import { findUserByIdAsync, getCurrentUserAsync } from '../../lib/usersHelpers';

interface InteractionDetailsProps {
  interaction: IInteraction;
  onInteractionDeleted?: () => void; // Callback when interaction is deleted
  onInteractionUpdated?: (updatedInteraction: IInteraction) => void; // Callback when interaction is updated
  isInDrawer?: boolean; // Whether this component is displayed in a drawer
}

// Helper to format duration from total minutes to "Xh Ym" format
const formatDuration = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else {
    return `${minutes}m`;
  }
};


const InteractionDetails: React.FC<InteractionDetailsProps> = ({ interaction: initialInteraction, onInteractionDeleted, onInteractionUpdated, isInDrawer = false }) => {
  const [interaction, setInteraction] = useState<IInteraction>(initialInteraction);
  const { openDrawer, goBack, closeDrawer } = useDrawer();
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  const [isEditInteractionOpen, setIsEditInteractionOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [userFullName, setUserFullName] = useState<string>('');

  // UI Reflection System Integration
  const { automationIdProps: editButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-edit-button',
    type: 'button',
    label: 'Edit Interaction',
    helperText: 'Edit this interaction details'
  });

  const { automationIdProps: deleteButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-delete-button',
    type: 'button',
    label: 'Delete Interaction',
    helperText: 'Delete this interaction permanently'
  });

  const { automationIdProps: backButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-back-button',
    type: 'button',
    label: 'Back',
    helperText: 'Go back to previous view'
  });

  const { automationIdProps: addTicketButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-add-ticket-button',
    type: 'button',
    label: 'Add Ticket',
    helperText: 'Create a new ticket related to this interaction'
  });

  const { automationIdProps: addTimeEntryButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: 'interaction-details-add-time-entry-button',
    type: 'button',
    label: 'Add Time Entry',
    helperText: 'Add time entry for this interaction'
  });

  useEffect(() => {
    console.log('Initial interaction:', initialInteraction);
    setInteraction(initialInteraction);
    
    // Fetch user's full name
    const fetchUserFullName = async () => {
      if (initialInteraction.user_id) {
        try {
          const user = await findUserByIdAsync(initialInteraction.user_id);
          if (user) {
            setUserFullName(`${user.first_name} ${user.last_name}`);
          }
        } catch (error) {
          console.error('Error fetching user full name:', error);
        }
      }
    };
    
    fetchUserFullName();
  }, [initialInteraction]);

  console.log('Current interaction state:', interaction);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };


  const handleContactClick = async () => {
    if (interaction.contact_name_id) {
      try {
        const contact = await getContactByContactNameId(interaction.contact_name_id);
        if (contact) {
          const clients = await getAllClients();
          openDrawer(
            <ContactDetailsView 
              initialContact={contact} 
              clients={clients}
              isInDrawer={true}
            />
          );
        } else {
          console.error('Contact not found');
        }
      } catch (error) {
        console.error('Error fetching contact details:', error);
      }
    } else {
      console.log('No contact associated with this interaction');
    }
  };

  const handleClientClick = async () => {
    if (interaction.client_id) {
      try {
        const client = await getClientById(interaction.client_id);
        if (client) {
          openDrawer(
            <ClientDetails
              client={client}
              documents={[]}
              contacts={[]}
              isInDrawer={true}
              quickView={true}
            />
          );
        } else {
          console.error('Client not found');
        }
      } catch (error) {
        console.error('Error fetching client details:', error);
      }
    } else {
      console.log('No client associated with this interaction');
    }
  };

  const handleTicketAdded = (ticket: ITicket) => {
    console.log('New ticket added:', ticket);
    setIsQuickAddTicketOpen(false);
  };

  const handleInteractionUpdated = async (updatedInteraction: IInteraction) => {
    setInteraction(updatedInteraction);
    setIsEditInteractionOpen(false);
    
    // Update user full name if user changed
    if (updatedInteraction.user_id) {
      try {
        const user = await findUserByIdAsync(updatedInteraction.user_id);
        if (user) {
          setUserFullName(`${user.first_name} ${user.last_name}`);
        }
      } catch (error) {
        console.error('Error fetching updated user full name:', error);
      }
    }
    
    // Notify parent component of the update
    if (onInteractionUpdated) {
      onInteractionUpdated(updatedInteraction);
    }
  };

  const handleUserClick = () => {
    if (interaction.user_id) {
      openDrawer(
        <AgentScheduleDrawer
          agentId={interaction.user_id}
        />
      );
    }
  };

  const handleDeleteInteraction = async () => {
    try {
      await deleteInteraction(interaction.interaction_id);
      setIsDeleteDialogOpen(false);
      
      // Call the callback to notify parent that interaction was deleted
      if (onInteractionDeleted) {
        onInteractionDeleted();
      }
      
      // Close the drawer completely
      closeDrawer();
    } catch (error) {
      console.error('Error deleting interaction:', error);
      // Handle error (e.g., show error message to user)
    }
  };

  const handleAddTimeEntry = async () => {
    try {
      toast('Time entry is managed in Scheduling.');
    } catch (error) {
      console.error('Error preparing time entry:', error);
      toast.error('Failed to prepare time entry. Please try again.');
    }
  };

  return (
    <ReflectionContainer id="interaction-details" label="Interaction Details">
      <div className="p-6 relative bg-white shadow rounded-lg">
      <div className="flex justify-between items-center mb-6">
        <Heading size="6">Interaction Details</Heading>
        <div className="flex gap-2">
          <Button
            {...editButtonProps}
            onClick={() => setIsEditInteractionOpen(true)}
            variant="ghost"
            size="sm"
          >
            <Pen className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button
            {...deleteButtonProps}
            onClick={() => setIsDeleteDialogOpen(true)}
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-800 hover:bg-red-50"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
          <Button
            {...backButtonProps}
            onClick={goBack}
            variant="ghost"
            size="sm"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      </div>
      
      <div className="space-y-6">
        <div className="flex items-center">
          <span className="font-semibold">Title:</span>
          <span className="ml-2 text-lg font-medium">{interaction.title || 'No title'}</span>
        </div>
        
        {interaction.notes && (
          <div className="space-y-2">
            <Text size="2" weight="bold">Notes</Text>
            <div className="prose max-w-none">
              <RichTextViewer content={(() => {
                const raw = (interaction.notes || '').trim();
                if (raw.startsWith('[') || raw.startsWith('{')) {
                  try {
                    return JSON.parse(raw);
                  } catch {
                    // fall through to plain-text wrapper
                  }
                }
                // Plain text or malformed JSON – wrap in a paragraph block
                return raw ? [{
                  type: "paragraph",
                  props: { textAlignment: "left", backgroundColor: "default", textColor: "default" },
                  content: [{ type: "text", text: raw, styles: {} }]
                }] : [];
              })()} />
            </div>
          </div>
        )}

        {interaction.status_name && (
          <div className="flex items-center">
            <span className="font-semibold">Status:</span>
            <span className="ml-2">{interaction.status_name}</span>
          </div>
        )}
        
        {interaction.start_time && (
          <div className="flex items-center">
            <span className="font-semibold">Start Time:</span>
            <span className="ml-2">
              {formatDate(interaction.start_time)}
            </span>
          </div>
        )}
        
        {interaction.end_time && (
          <div className="flex items-center">
            <span className="font-semibold">End Time:</span>
            <span className="ml-2">
              {formatDate(interaction.end_time)}
            </span>
          </div>
        )}
        
        {interaction.duration && (
          <div className="flex items-center">
            <span className="font-semibold">Duration:</span>
            <span className="ml-2">
              {formatDuration(interaction.duration)}
            </span>
          </div>
        )}
        
        <div className="flex items-center">
          <span className="font-semibold">User:</span>
          <button
            onClick={handleUserClick}
            className="ml-2 text-blue-500 hover:underline"
          >
            {userFullName || interaction.user_name || 'Unknown'}
          </button>
        </div>
        
        <div className="flex items-center">
          <span className="font-semibold">Contact:</span>
          {interaction.contact_name ? (
            <button
              onClick={handleContactClick}
              className="ml-2 text-blue-500 hover:underline"
            >
              {interaction.contact_name}
            </button>
          ) : (
            <span className="ml-2">No contact associated</span>
          )}
        </div>
        
        <div className="flex items-center">
          <span className="font-semibold">Client:</span>
          {interaction.client_name ? (
            <button
              onClick={handleClientClick}
              className="ml-2 text-blue-500 hover:underline"
            >
              {interaction.client_name}
            </button>
          ) : (
            <span className="ml-2">No client associated</span>
          )}
        </div>
      </div>

      <Flex justify="end" align="center" className="mt-6 gap-2">
        {!isInDrawer && (
          <Button
            {...addTimeEntryButtonProps}
            onClick={handleAddTimeEntry}
            variant="default"
          >
            <Clock className="mr-2 h-4 w-4" />
            Add Time Entry
          </Button>
        )}
        <Button
          {...addTicketButtonProps}
          onClick={() => setIsQuickAddTicketOpen(true)}
          variant="default"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Ticket
        </Button>
      </Flex>

      <QuickAddTicket
        id='quick-add-ticket'
        open={isQuickAddTicketOpen}
        onOpenChange={setIsQuickAddTicketOpen}
        onTicketAdded={handleTicketAdded}
        prefilledClient={interaction.client_id ? {
          id: interaction.client_id,
          name: interaction.client_name || ''
        } : undefined}
        prefilledContact={interaction.contact_name_id ? {
          id: interaction.contact_name_id,
          name: interaction.contact_name || ''
        } : undefined}
        prefilledDescription={(() => {
          try {
            const content = JSON.parse(interaction.notes || '[]');
            // Simple extraction of text from paragraph nodes
            return content.map((block: any) => {
              if (block.type === 'paragraph' && block.content) {
                return block.content.map((item: any) => item.text).join('');
              }
              return ''; // Ignore other block types for now
            }).join('\n'); // Join paragraphs with newlines
          } catch (e) {
            // If parsing fails, return the raw text
            return interaction.notes || '';
          }
        })()}
      />

      <QuickAddInteraction
        id="edit-interaction"
        entityId={interaction.contact_name_id || interaction.client_id || ''}
        entityType={interaction.contact_name_id ? 'contact' : 'client'}
        clientId={interaction.client_id || undefined}
        onInteractionAdded={handleInteractionUpdated}
        isOpen={isEditInteractionOpen}
        onClose={() => setIsEditInteractionOpen(false)}
        editingInteraction={interaction}
      />

      <ConfirmationDialog
        id="delete-interaction-dialog"
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteInteraction}
        title="Delete Interaction"
        message="Are you sure you want to delete this interaction? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
      </div>
    </ReflectionContainer>
  );
};

export default InteractionDetails;
