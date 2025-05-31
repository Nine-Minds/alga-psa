// src/components/interactions/InteractionDetails.tsx

import React, { useState, useEffect } from 'react';
import { IInteraction } from 'server/src/interfaces/interaction.interfaces';
import { Clock, FileText, ArrowLeft, Plus, Pen, Trash2 } from 'lucide-react';
import { useDrawer } from "server/src/context/DrawerContext";
import ContactDetailsView from '../contacts/ContactDetailsView';
import CompanyDetails from '../companies/CompanyDetails';
import AgentScheduleDrawer from '../tickets/ticket/AgentScheduleDrawer';
import { Button } from 'server/src/components/ui/Button';
import { QuickAddTicket } from '../tickets/QuickAddTicket';
import { QuickAddInteraction } from './QuickAddInteraction';
import { ITicket } from 'server/src/interfaces';
import { getContactByContactNameId } from 'server/src/lib/actions/contact-actions/contactActions';
import { getCompanyById, getAllCompanies } from 'server/src/lib/actions/company-actions/companyActions';
import { findUserById } from 'server/src/lib/actions/user-actions/userActions';
import { deleteInteraction } from 'server/src/lib/actions/interactionActions';
import { Text, Flex, Heading } from '@radix-ui/themes';
import RichTextViewer from '../editor/RichTextViewer';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';

interface InteractionDetailsProps {
  interaction: IInteraction;
  onInteractionDeleted?: () => void; // Callback when interaction is deleted
  onInteractionUpdated?: (updatedInteraction: IInteraction) => void; // Callback when interaction is updated
}


const InteractionDetails: React.FC<InteractionDetailsProps> = ({ interaction: initialInteraction, onInteractionDeleted, onInteractionUpdated }) => {
  const [interaction, setInteraction] = useState<IInteraction>(initialInteraction);
  const { openDrawer, goBack, closeDrawer } = useDrawer();
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  const [isEditInteractionOpen, setIsEditInteractionOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [userFullName, setUserFullName] = useState<string>('');

  useEffect(() => {
    console.log('Initial interaction:', initialInteraction);
    setInteraction(initialInteraction);
    
    // Fetch user's full name
    const fetchUserFullName = async () => {
      if (initialInteraction.user_id) {
        try {
          const user = await findUserById(initialInteraction.user_id);
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
          const companies = await getAllCompanies();
          openDrawer(
            <ContactDetailsView 
              initialContact={contact} 
              companies={companies}
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

  const handleCompanyClick = async () => {
    if (interaction.company_id) {
      try {
        const company = await getCompanyById(interaction.company_id);
        if (company) {
          openDrawer(
            <CompanyDetails 
              company={company} 
              documents={[]} 
              contacts={[]} 
              isInDrawer={true}
            />
          );
        } else {
          console.error('Company not found');
        }
      } catch (error) {
        console.error('Error fetching company details:', error);
      }
    } else {
      console.log('No company associated with this interaction');
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
        const user = await findUserById(updatedInteraction.user_id);
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

  return (
    <div className="p-6 relative bg-white shadow rounded-lg">
      <div className="flex justify-between items-center mb-6">
        <Heading size="6">Interaction Details</Heading>
        <div className="flex gap-2">
          <Button
            id="edit-interaction-button"
            onClick={() => setIsEditInteractionOpen(true)}
            variant="ghost"
            size="sm"
          >
            <Pen className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button
            id="delete-interaction-button"
            onClick={() => setIsDeleteDialogOpen(true)}
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-800 hover:bg-red-50"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
          <Button
            id="back-button"
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
                try {
                  return JSON.parse(interaction.notes || '[]');
                } catch (e) {
                  // If parsing fails, return a simple paragraph with the text
                  return [{
                    type: "paragraph",
                    props: {
                      textAlignment: "left",
                      backgroundColor: "default",
                      textColor: "default"
                    },
                    content: [{
                      type: "text",
                      text: interaction.notes || '',
                      styles: {}
                    }]
                  }];
                }
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
              {interaction.duration} minutes
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
          <span className="font-semibold">Company:</span>
          {interaction.company_name ? (
            <button
              onClick={handleCompanyClick}
              className="ml-2 text-blue-500 hover:underline"
            >
              {interaction.company_name}
            </button>
          ) : (
            <span className="ml-2">No company associated</span>
          )}
        </div>
      </div>

      <Flex justify="end" align="center" className="mt-6">
        <Button
          id="add-ticket-button"
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
        prefilledCompany={interaction.company_id ? {
          id: interaction.company_id,
          name: interaction.company_name || ''
        } : undefined}
        prefilledContact={interaction.contact_name_id ? {
          id: interaction.contact_name_id,
          name: interaction.contact_name || ''
        } : undefined}
        prefilledDescription={interaction.notes}
      />

      <QuickAddInteraction
        id="edit-interaction"
        entityId={interaction.contact_name_id || interaction.company_id || ''}
        entityType={interaction.contact_name_id ? 'contact' : 'company'}
        companyId={interaction.company_id || undefined}
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
  );
};

export default InteractionDetails;
