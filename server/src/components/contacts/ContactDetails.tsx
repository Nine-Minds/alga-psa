'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IInteraction } from 'server/src/interfaces/interaction.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Button } from '../ui/Button';
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
import { getContactAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';
import { updateContact, getContactByContactNameId } from 'server/src/lib/actions/contact-actions/contactActions';
import Documents from 'server/src/components/documents/Documents';
import ContactDetailsEdit from './ContactDetailsEdit';
import { useToast } from 'server/src/hooks/use-toast';
import ContactTickets from './ContactTickets';
import { getTicketFormOptions } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { IChannel } from 'server/src/interfaces/channel.interface';
import { SelectOption } from 'server/src/components/ui/CustomSelect';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { TagManager } from 'server/src/components/tags';
import { findTagsByEntityIds } from 'server/src/lib/actions/tagActions';
import { useTags } from 'server/src/context/TagContext';
import ContactAvatarUpload from 'server/src/components/client-portal/contacts/ContactAvatarUpload';
import CompanyAvatar from 'server/src/components/ui/CompanyAvatar';
import { getCompanyById } from 'server/src/lib/actions/company-actions/companyActions';
import CompanyDetails from 'server/src/components/companies/CompanyDetails';

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

const DateDetailItem: React.FC<{
  label: string;
  value: string | null;
  onEdit: (value: string) => void;
}> = ({ label, value, onEdit }) => {
  const [localValue, setLocalValue] = useState(value ? value.split('T')[0] : '');

  const handleBlur = () => {
    if (localValue !== (value ? value.split('T')[0] : '')) {
      onEdit(localValue);
    }
  };
  
  return (
    <div className="space-y-2">
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <Input
        type="date"
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
  const [originalContact, setOriginalContact] = useState<IContact>(contact);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [tags, setTags] = useState<ITag[]>([]);
  const { tags: allTags } = useTags();
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
    setOriginalContact(contact);
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

  // Fetch contact avatar URL and tags
  useEffect(() => {
    const fetchAvatarAndTags = async () => {
      if (userId && contact.tenant) {
        try {
          const [contactAvatarUrl, fetchedTags] = await Promise.all([
            getContactAvatarUrlAction(contact.contact_name_id, contact.tenant),
            findTagsByEntityIds([contact.contact_name_id], 'contact')
          ]);
          
          setAvatarUrl(contactAvatarUrl);
          setTags(fetchedTags);
        } catch (error) {
          console.error('Error fetching avatar and tags:', error);
        }
      }
    };
    fetchAvatarAndTags();
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
      // Make sure contact_name_id is included in the data being sent
      const dataToUpdate = {
        ...editedContact,
        contact_name_id: editedContact.contact_name_id
      };
      
      const updatedContact = await updateContact(dataToUpdate);
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

  const handleTagsChange = (updatedTags: ITag[]) => {
    setTags(updatedTags);
  };

  const handleCompanyClick = async () => {
    if (editedContact.company_id) {
      try {
        const company = await getCompanyById(editedContact.company_id);
        if (company) {
          // Use router to temporarily set tab to details for the drawer
          const params = new URLSearchParams(searchParams?.toString() || '');
          params.set('tab', 'details');
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          
          // Small delay to ensure the URL is updated before opening drawer
          setTimeout(() => {
            drawer.openDrawer(
              <CompanyDetails 
                company={company} 
                documents={[]} 
                contacts={[]} 
                isInDrawer={true}
              />
            );
          }, 10);
        } else {
          console.error('Company not found');
        }
      } catch (error) {
        console.error('Error fetching company details:', error);
      }
    } else {
      console.log('No company associated with this contact');
    }
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TextDetailItem
              label="Full Name"
              value={editedContact.full_name}
              onEdit={(value) => handleFieldChange('full_name', value)}
            />
            <div className="space-y-2">
              <Text as="label" size="2" className="text-gray-700 font-medium">Company</Text>
              {originalContact.company_id ? (
                // Display company as clickable link if contact already has a company
                <div className="flex items-center gap-2 py-2 cursor-pointer hover:bg-gray-50 rounded px-2" onClick={handleCompanyClick}>
                  <CompanyAvatar 
                    companyId={editedContact.company_id!}
                    companyName={getCompanyName(editedContact.company_id!)}
                    logoUrl={companies.find(c => c.company_id === editedContact.company_id!)?.logoUrl || null}
                    size="sm"
                  />
                  <span className="text-blue-500 hover:underline text-sm">{getCompanyName(editedContact.company_id!)}</span>
                </div>
              ) : (
                // Allow company selection if contact has no company originally
                <CompanyPicker
                  id="contact-company-picker"
                  onSelect={(companyId) => handleFieldChange('company_id', companyId || '')}
                  selectedCompanyId={editedContact.company_id}
                  companies={companies}
                  filterState="active"
                  onFilterStateChange={() => {}}
                  clientTypeFilter="all"
                  onClientTypeFilterChange={() => {}}
                />
              )}
            </div>
            <TextDetailItem
              label="Email"
              value={editedContact.email || ''}
              onEdit={(value) => handleFieldChange('email', value)}
            />
            <TextDetailItem
              label="Role"
              value={editedContact.role || ''}
              onEdit={(value) => handleFieldChange('role', value)}
            />
            <TextDetailItem
              label="Phone Number"
              value={editedContact.phone_number || ''}
              onEdit={(value) => handleFieldChange('phone_number', value)}
            />
            <SwitchDetailItem
              value={!editedContact.is_inactive || false}
              onEdit={(isActive) => handleFieldChange('is_inactive', !isActive)}
            />
          </div>

          {/* Tags Section */}
          <div className="space-y-2">
            <Text as="label" size="2" className="text-gray-700 font-medium">Tags</Text>
            <TagManager
              entityId={editedContact.contact_name_id}
              entityType="contact"
              initialTags={tags}
              onTagsChange={handleTagsChange}
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
              contactName={editedContact.full_name}
              companyId={editedContact.company_id || ''}
              companyName={getCompanyName(editedContact.company_id || '')}
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
        
        {/* Contact Avatar Upload */}
        <div className="mr-4">
          <ContactAvatarUpload
            contactId={editedContact.contact_name_id}
            contactName={editedContact.full_name}
            avatarUrl={avatarUrl}
            userType="internal"
            onAvatarChange={(newAvatarUrl) => {
              console.log("ContactDetails: Avatar URL changed:", newAvatarUrl);
              setAvatarUrl(newAvatarUrl);
            }}
          />
        </div>
        
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