// src/components/interactions/InteractionDetails.tsx

import React, { useState, useEffect } from 'react';
import { IInteraction } from '@/interfaces/interaction.interfaces';
import { Calendar, Clock, User, Briefcase, FileText, ArrowLeft, Plus, Pen, Check, X } from 'lucide-react';
import { useDrawer } from '@/context/DrawerContext';
import ContactDetailsView from '../contacts/ContactDetailsView';
import CompanyDetails from '../companies/CompanyDetails';
import { Button } from '@/components/ui/Button';
import { QuickAddTicket } from '../tickets/QuickAddTicket';
import { ITicket } from '@/interfaces';
import { getContactByContactNameId } from '@/lib/actions/contact-actions/contactActions';
import { getCompanyById, getAllCompanies } from '@/lib/actions/companyActions';
import { updateInteraction } from '@/lib/actions/interactionActions';
import { Text, Flex, Heading } from '@radix-ui/themes';

interface InteractionDetailsProps {
  interaction: IInteraction;
}

interface EditableFieldProps {
  label: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  icon: React.ReactNode;
}

const EditableField: React.FC<EditableFieldProps> = ({ label, value, onSave, icon }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleSave = async () => {
    try {
      await onSave(localValue);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving field:', error);
    }
  };

  const handleCancel = () => {
    setLocalValue(value);
    setIsEditing(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
        {!isEditing && (
          <Button 
            id={`edit-field-${label.toLowerCase().replace(/\s+/g, '-')}`}
            variant="ghost" 
            size="sm" 
            onClick={() => setIsEditing(true)}
          >
            <Pen className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center">
        {icon}
        {isEditing ? (
          <div className="flex-grow ml-2">
            <input
              type="text"
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <div className="flex justify-end mt-2">
              <Button id='cancel-button' variant="outline" size="sm" onClick={handleCancel}>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button id="save-button" variant="default" size="sm" onClick={handleSave}>
                <Check className="h-4 w-4 mr-1" />
                Save
              </Button>
            </div>
          </div>
        ) : (
          <span className="ml-2">{value}</span>
        )}
      </div>
    </div>
  );
};

const InteractionDetails: React.FC<InteractionDetailsProps> = ({ interaction: initialInteraction }) => {
  const [interaction, setInteraction] = useState<IInteraction>(initialInteraction);
  const { openDrawer, goBack } = useDrawer();
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);

  useEffect(() => {
    console.log('Initial interaction:', initialInteraction);
    setInteraction(initialInteraction);
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

  const handleSaveField = async (field: keyof IInteraction, value: string) => {
    try {
      const updatedInteraction = await updateInteraction(interaction.interaction_id!, { [field]: value });
      setInteraction(updatedInteraction);
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
      throw error;
    }
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

  return (
    <div className="p-6 relative bg-white shadow rounded-lg">
      <Button
        id="back-button"
        onClick={goBack}
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>
      
      <Heading size="6" className="mb-6">Interaction Details</Heading>
      
      <div className="space-y-4">
        <EditableField 
          label="Description" 
          value={interaction.description || 'No description'}
          onSave={(value) => handleSaveField('description', value)}
          icon={<FileText className="w-5 h-5 text-gray-500" />}
        />
        <EditableField 
          label="Duration (minutes)" 
          value={interaction.duration?.toString() || 'Not set'}
          onSave={(value) => handleSaveField('duration', value)}
          icon={<Clock className="w-5 h-5 text-gray-500" />}
        />
        <div className="flex items-center">
          <Calendar className="w-5 h-5 mr-2 text-gray-500" />
          <span className="font-semibold">Date:</span>
          <span className="ml-2">
            {interaction.interaction_date ? formatDate(interaction.interaction_date) : 'Not set'}
          </span>
        </div>
        <div className="flex items-center">
          <User className="w-5 h-5 mr-2 text-gray-500" />
          <span className="font-semibold">User:</span>
          <span className="ml-2">{interaction.user_name || 'Unknown'}</span>
        </div>
        <div className="flex items-center">
          <User className="w-5 h-5 mr-2 text-gray-500" />
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
          <Briefcase className="w-5 h-5 mr-2 text-gray-500" />
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
          className="bg-purple-600 hover:bg-purple-700 text-white"
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
        prefilledDescription={interaction.description}
      />
    </div>
  );
};

export default InteractionDetails;
