'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IInteraction } from 'server/src/interfaces/interaction.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Button } from '../ui/Button';
import { Pen } from 'lucide-react';
import { Switch } from 'server/src/components/ui/Switch';
import { Input } from 'server/src/components/ui/Input';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import BackNav from 'server/src/components/ui/BackNav';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { useDrawer } from "server/src/context/DrawerContext";
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Card } from 'server/src/components/ui/Card';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
import { getContactAvatarUrl } from 'server/src/lib/utils/avatarUtils';
import { updateContact, getContactByContactNameId } from 'server/src/lib/actions/contact-actions/contactActions';
import Documents from 'server/src/components/documents/Documents';
import ContactDetailsEdit from './ContactDetailsEdit';
import { useToast } from 'server/src/hooks/use-toast';
import ContactTickets from './ContactTickets';
import { getTicketFormOptions } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { IChannel } from 'server/src/interfaces/channel.interface';
import { SelectOption } from 'server/src/components/ui/CustomSelect';

const SwitchDetailItem: React.FC<{
  value: boolean;
  onEdit: (value: boolean) => void;
}> = ({ value, onEdit }) => {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="text-gray-900 font-medium">Status</div>
        <div className="text-sm text-gray-500">Set contact status as active or inactive</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-700">
          {value ? 'Active' : 'Inactive'}
        </span>
        <Switch
          checked={value}
          onCheckedChange={onEdit}
          className="data-[state=checked]:bg-primary-500"
        />
      </div>
    </div>
  );
};

const TextDetailItem: React.FC<{
  label: string;
  value: string;
  onEdit: (value: string) => void;
}> = ({ label, value, onEdit }) => {
  const [localValue, setLocalValue] = useState(value);

  const handleBlur = () => {
    if (localValue !== value) {
      onEdit(localValue);
    }
  };
  
  return (
    <div className="space-y-2">
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <Input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      />
    </div>
  );
};

interface ContactDetailsProps {
  id?: string;
  contact: IContact;
  companies: ICompany[];
  documents?: IDocument[];
  isInDrawer?: boolean;
  userId?: string;
  onDocumentCreated?: () => Promise<void>;
}

const ContactDetails: React.FC<ContactDetailsProps> = ({
  id = 'contact-details',
  contact,
  companies,
  documents = [],
  isInDrawer = false,
  userId,
  onDocumentCreated
}) => {
  const [editedContact, setEditedContact] = useState<IContact>(contact);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [ticketFormOptions, setTicketFormOptions] = useState<{
    statusOptions: SelectOption[];
    priorityOptions: SelectOption[];
    channelOptions: IChannel[];
    categories: ITicketCategory[];
  } | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const drawer = useDrawer();

  // Implement refreshContactData function
  const refreshContactData = useCallback(async () => {
    if (!contact?.contact_name_id) return;

    console.log(`Refreshing contact data for ID: ${contact.contact_name_id}`);
    try {
      const latestContactData = await getContactByContactNameId(contact.contact_name_id);
      if (latestContactData) {
        setEditedContact(latestContactData);
        console.log('Contact data refreshed successfully');
      }
    } catch (error) {
      console.error('Error refreshing contact data:', error);
      toast({
        title: "Refresh Failed",
        description: "Could not fetch latest contact data.",
        variant: "destructive"
      });
    }
  }, [contact?.contact_name_id, toast]);

  // Initial Load Logic
  useEffect(() => {
    setEditedContact(contact);
    setHasUnsavedChanges(false);
  }, [contact]);

  // Fetch current user
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };
    fetchUser();
  }, []);

  // Fetch ticket form options when user is available
  useEffect(() => {
    const fetchTicketFormOptions = async () => {
      if (!currentUser) return;
      try {
        const options = await getTicketFormOptions(currentUser);
        setTicketFormOptions({
          statusOptions: options.statusOptions,
          priorityOptions: options.priorityOptions,
          channelOptions: options.channelOptions,
          categories: options.categories
        });
      } catch (error) {
        console.error('Error fetching ticket form options:', error);
      }
    };

    if (currentUser) {
      fetchTicketFormOptions();
    }
  }, [currentUser]);

  // Fetch contact avatar URL
  useEffect(() => {
    const fetchAvatar = async () => {
      if (userId && contact.tenant) {
        try {
          const contactAvatarUrl = await getContactAvatarUrl(contact.contact_name_id, contact.tenant);
          setAvatarUrl(contactAvatarUrl);
        } catch (error) {
          console.error('Error fetching avatar:', error);
        }
      }
    };
    fetchAvatar();
  }, [contact.contact_name_id, contact.tenant, userId]);

  const handleFieldChange = (field: string, value: string | boolean) => {
    setEditedContact(prevContact => ({
      ...prevContact,
      [field]: value
    }));
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    try {
      const updatedContact = await updateContact(editedContact.contact_name_id, editedContact);
      setEditedContact(updatedContact);
      setHasUnsavedChanges(false);
      toast({
        title: "Contact Updated",
        description: "Contact details have been saved successfully.",
      });
    } catch (error) {
      console.error('Error saving contact:', error);
      toast({
        title: "Save Failed",
        description: "Could not save contact details. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleEdit = () => {
    drawer.openDrawer(
      <ContactDetailsEdit
        id={`${id}-edit`}
        initialContact={editedContact}
        companies={companies}
        isInDrawer={true}
        onSave={(updatedContact) => {
          setEditedContact(updatedContact);
          // Close the edit drawer and show updated details
          drawer.goBack();
        }}
        onCancel={() => {
          drawer.goBack();
        }}
      />
    );
  };

  const handleInteractionAdded = (newInteraction: IInteraction) => {
    setInteractions(prevInteractions => {
      const updatedInteractions = [newInteraction, ...prevInteractions];
      return updatedInteractions.filter((interaction, index, self) =>
        index === self.findIndex((t) => t.interaction_id === interaction.interaction_id)
      );
    });
  };

  const handleTabChange = async (tabValue: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', tabValue);
    router.push(`${pathname}?${params.toString()}`);
  };

  const getCompanyName = (companyId: string) => {
    const company = companies.find(c => c.company_id === companyId);
    return company ? company.company_name : 'Unknown Company';
  };

  const formatDateForDisplay = (dateString: string | null | undefined): string => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const tabContent = [
    {
      label: "Details",
      content: (
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center">
              {userId && (
                <div className="mr-4">
                  <ContactAvatar
                    contactId={editedContact.contact_name_id}
                    contactName={editedContact.full_name}
                    avatarUrl={avatarUrl}
                    size="lg"
                  />
                </div>
              )}
              <div>
                <Heading size="6">{editedContact.full_name}</Heading>
                <Text className="text-gray-600">{getCompanyName(editedContact.company_id!)}</Text>
              </div>
            </div>
            <Button
              onClick={handleEdit}
              variant="soft"
              size="sm"
              className="flex items-center"
            >
              <Pen className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TextDetailItem
              label="Full Name"
              value={editedContact.full_name}
              onEdit={(value) => handleFieldChange('full_name', value)}
            />
            <TextDetailItem
              label="Email"
              value={editedContact.email || ''}
              onEdit={(value) => handleFieldChange('email', value)}
            />
            <TextDetailItem
              label="Phone Number"
              value={editedContact.phone_number || ''}
              onEdit={(value) => handleFieldChange('phone_number', value)}
            />
            <TextDetailItem
              label="Role"
              value={editedContact.role || ''}
              onEdit={(value) => handleFieldChange('role', value)}
            />
            <div className="space-y-2">
              <Text as="label" size="2" className="text-gray-700 font-medium">Date of Birth</Text>
              <Text className="text-sm text-gray-600">{formatDateForDisplay(editedContact.date_of_birth)}</Text>
            </div>
            <SwitchDetailItem
              value={!editedContact.is_inactive || false}
              onEdit={(isActive) => handleFieldChange('is_inactive', !isActive)}
            />
          </div>

          {editedContact.notes && (
            <div className="space-y-2">
              <Text as="label" size="2" className="text-gray-700 font-medium">Notes</Text>
              <div className="bg-gray-50 p-3 rounded-md border border-gray-200">
                <Text className="text-sm whitespace-pre-wrap">{editedContact.notes}</Text>
              </div>
            </div>
          )}
          
          <Flex gap="4" justify="end" align="center" className="pt-6">
            <Button
              id="save-contact-changes-btn"
              onClick={handleSave}
              disabled={!hasUnsavedChanges}
              className={`text-white transition-colors ${
                hasUnsavedChanges
                  ? "bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))]"
                  : "bg-[rgb(var(--color-border-400))] cursor-not-allowed"
              }`}
            >
              Save Changes
            </Button>
          </Flex>
        </div>
      )
    },
    {
      label: "Tickets",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          {ticketFormOptions ? (
            <ContactTickets 
              contactId={editedContact.contact_name_id}
              initialChannels={ticketFormOptions.channelOptions}
              initialStatuses={ticketFormOptions.statusOptions}
              initialPriorities={ticketFormOptions.priorityOptions}
              initialCategories={ticketFormOptions.categories}
            />
          ) : (
            <div className="flex justify-center items-center h-32">
              <span>Loading ticket filters...</span>
            </div>
          )}
        </div>
      )
    },
    {
      label: "Documents",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          {currentUser ? (
            <Documents
              id={`${id}-documents`}
              documents={documents}
              gridColumns={3}
              userId={currentUser.user_id}
              entityId={editedContact.contact_name_id}
              entityType="contact"
              onDocumentCreated={onDocumentCreated || (async () => {})}
            />
          ) : (
            <div>Loading...</div>
          )}
        </div>
      )
    },
    {
      label: "Interactions",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <InteractionsFeed
            entityId={editedContact.contact_name_id}
            entityType="contact"
            companyId={editedContact.company_id!}
            interactions={interactions}
            setInteractions={setInteractions}
          />
        </div>
      )
    }
  ];

  // Find the matching tab label case-insensitively
  const findTabLabel = (urlTab: string | null | undefined): string => {
    if (!urlTab) return 'Details';
    
    const matchingTab = tabContent.find(
      tab => tab.label.toLowerCase() === urlTab.toLowerCase()
    );
    return matchingTab?.label || 'Details';
  };

  return (
    <ReflectionContainer id={id} label="Contact Details">
      <div className="flex items-center space-x-5 mb-4 pt-2">
        <BackNav href={!isInDrawer ? "/msp/contacts" : undefined}>
          {isInDrawer ? 'Back' : 'Back to Contacts'}
        </BackNav>
        
        <Heading size="6">{editedContact.full_name}</Heading>
      </div>

      {/* Content Area */}
      <div>
        <CustomTabs
          tabs={tabContent}
          defaultTab={findTabLabel(searchParams?.get('tab'))}
          onTabChange={handleTabChange}
        />
      </div>
    </ReflectionContainer>
  );
};

export default ContactDetails;