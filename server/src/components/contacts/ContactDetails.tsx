'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IInteraction } from 'server/src/interfaces/interaction.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Button } from '../ui/Button';
import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Switch } from 'server/src/components/ui/Switch';
import { Input } from 'server/src/components/ui/Input';
import { PhoneInput } from 'server/src/components/ui/PhoneInput';
import { DatePicker } from 'server/src/components/ui/DatePicker';import CustomTabs from 'server/src/components/ui/CustomTabs';
import BackNav from 'server/src/components/ui/BackNav';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { useDrawer } from "server/src/context/DrawerContext";
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Card } from 'server/src/components/ui/Card';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { getContactAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';
import { updateContact, getContactByContactNameId, deleteContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { validateEmailAddress, validatePhoneNumber, validateContactName, validateRole } from 'server/src/lib/utils/clientFormValidation';
import Documents from 'server/src/components/documents/Documents';
import ContactDetailsEdit from './ContactDetailsEdit';
import { useToast } from 'server/src/hooks/use-toast';
import ContactTickets from './ContactTickets';
import { getTicketFormOptions } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { IBoard } from 'server/src/interfaces/board.interface';
import { SelectOption } from 'server/src/components/ui/CustomSelect';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import { TagManager } from 'server/src/components/tags';
import { findTagsByEntityIds } from 'server/src/lib/actions/tagActions';
import { useTags } from 'server/src/context/TagContext';
import ContactAvatarUpload from 'server/src/components/client-portal/contacts/ContactAvatarUpload';
import ClientAvatar from 'server/src/components/ui/ClientAvatar';
import { getClientById } from 'server/src/lib/actions/client-actions/clientActions';
import { getAllCountries, ICountry } from 'server/src/lib/actions/client-actions/countryActions';
import ClientDetails from 'server/src/components/clients/ClientDetails';
import { ContactPortalTab } from './ContactPortalTab';

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
  automationId?: string;
  validate?: (value: string) => string | null;
}> = ({ label, value, onEdit, automationId, validate }) => {
  const [localValue, setLocalValue] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const handleBlur = () => {
    // Professional SaaS validation pattern: validate on blur, not while typing
    if (validate) {
      const validationError = validate(localValue);
      setError(validationError);
    }

    if (localValue !== value) {
      onEdit(localValue);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    // Clear error while typing
    if (error) {
      setError(null);
    }
  };

  return (
    <div className="space-y-2">
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <Input
        type="text"
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
          error ? 'border-red-500' : 'border-gray-200'
        }`}
        data-automation-id={automationId}
      />
      {error && (
        <div className="text-red-500 text-xs mt-1">{error}</div>
      )}
    </div>
  );
};

const DateDetailItem: React.FC<{
  label: string;
  value: string | null;
  onEdit: (value: string) => void;
}> = ({ label, value, onEdit }) => {
  const [localValue, setLocalValue] = useState<Date | undefined>(
    value ? new Date(value.split('T')[0]) : undefined
  );

  const handleChange = (date: Date | undefined) => {
    setLocalValue(date);
    if (date) {
      const dateString = date.toISOString().split('T')[0];
      if (dateString !== (value ? value.split('T')[0] : '')) {
        onEdit(dateString);
      }
    } else if (value) {
      onEdit('');
    }
  };
  
  return (
    <div className="space-y-2">
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <DatePicker
        value={localValue}
        onChange={handleChange}
        placeholder="Select date"
      />
    </div>
  );
};

interface ContactDetailsProps {
  id?: string;
  contact: IContact;
  clients: IClient[];
  documents?: IDocument[];
  isInDrawer?: boolean;
  quickView?: boolean;
  userId?: string;
  onDocumentCreated?: () => Promise<void>;
  onContactUpdated?: () => Promise<void>;
  onChangesSaved?: () => void;
  userPermissions?: {
    canInvite: boolean;
    canUpdateRoles: boolean;
    canRead: boolean;
  };
}

const ContactDetails: React.FC<ContactDetailsProps> = ({
  id = 'contact-details',
  contact,
  clients,
  documents = [],
  isInDrawer = false,
  quickView = false,
  userId,
  onDocumentCreated,
  onContactUpdated,
  onChangesSaved,
  userPermissions = {
    canInvite: false,
    canUpdateRoles: false,
    canRead: false
  }
}) => {
  const [editedContact, setEditedContact] = useState<IContact>(contact);
  const [originalContact, setOriginalContact] = useState<IContact>(contact);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [tags, setTags] = useState<ITag[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeactivateOption, setShowDeactivateOption] = useState(false);
  const { tags: allTags } = useTags();
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(contact.client_id || null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [ticketFormOptions, setTicketFormOptions] = useState<{
    statusOptions: SelectOption[];
    priorityOptions: SelectOption[];
    boardOptions: IBoard[];
    categories: ITicketCategory[];
    tags?: string[];
  } | null>(null);
  const [countries, setCountries] = useState<ICountry[]>([]);
  const [countryCode, setCountryCode] = useState(() => {
    // Enterprise locale detection
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      const parts = locale.split('-');
      const detectedCountry = parts[parts.length - 1]?.toUpperCase();

      if (detectedCountry && detectedCountry.length === 2 && /^[A-Z]{2}$/.test(detectedCountry)) {
        return detectedCountry;
      }
    } catch (e) {
      // Fallback to US if detection fails
    }
    return 'US';
  });
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
    setSelectedClientId(contact.client_id || null);
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
          boardOptions: options.boardOptions,
          categories: options.categories,
          tags: options.tags
        });
      } catch (error) {
        console.error('Error fetching ticket form options:', error);
      }
    };

    if (currentUser) {
      fetchTicketFormOptions();
    }
  }, [currentUser]);

  // Load countries
  useEffect(() => {
    const fetchCountries = async () => {
      if (countries.length > 0) return; // Don't fetch if already loaded
      try {
        const countriesData = await getAllCountries();
        setCountries(countriesData);
      } catch (error: any) {
        console.error("Error fetching countries:", error);
      }
    };
    fetchCountries();
  }, [countries.length]);

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

  const handleCountryChange = (countryCode: string) => {
    setCountryCode(countryCode);
    // When country changes, the PhoneInput will auto-update with the new phone code
  };

  const handleDeleteContact = () => {
    setDeleteError(null);
    setShowDeactivateOption(false);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    try {
      await deleteContact(editedContact.contact_name_id);

      setIsDeleteDialogOpen(false);

      toast({
        title: "Contact Deleted",
        description: "Contact has been deleted successfully.",
      });

      // Navigate back or close drawer depending on context
      if (isInDrawer) {
        drawer.closeDrawer();
      } else {
        router.push('/msp/contacts');
      }
    } catch (error: any) {
      console.error('Failed to delete contact:', error);

      // Handle dependency errors like the main contacts page
      if (error.message && error.message.includes('VALIDATION_ERROR: Cannot delete contact because it has associated records:')) {
        setDeleteError(error.message.replace('VALIDATION_ERROR: ', ''));
        setShowDeactivateOption(true);
        return;
      }

      setDeleteError(error.message || 'Failed to delete contact. Please try again.');
    }
  };

  const handleMarkContactInactive = async () => {
    try {
      const updatedContact = await updateContact({
        ...editedContact,
        is_inactive: true
      });

      setIsDeleteDialogOpen(false);

      toast({
        title: "Contact Deactivated",
        description: "Contact has been marked as inactive successfully.",
      });

      // Navigate back or close drawer depending on context
      if (isInDrawer) {
        drawer.closeDrawer();
      } else {
        router.push('/msp/contacts');
      }
    } catch (error: any) {
      console.error('Error marking contact as inactive:', error);
      setDeleteError('An error occurred while marking the contact as inactive. Please try again.');
    }
  };

  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setDeleteError(null);
    setShowDeactivateOption(false);
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
      setOriginalContact(updatedContact);
      setHasUnsavedChanges(false);

      toast({
        title: "Contact Updated",
        description: "Contact details have been saved successfully.",
      });
      
      // In quick view mode, mark that changes were saved (for refresh on drawer close)
      // In regular mode, refresh immediately to maintain existing behavior
      if (quickView && onChangesSaved) {
        onChangesSaved();
      } else if (!quickView && onContactUpdated) {
        await onContactUpdated();
      }
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

  const handleClientClick = async () => {
    if (editedContact.client_id) {
      try {
        const client = await getClientById(editedContact.client_id);
        if (client) {
          // In quick view mode, avoid URL manipulation to prevent navigation issues
          if (!quickView) {
            // Use router to temporarily set tab to details for the drawer
            const params = new URLSearchParams(searchParams?.toString() || '');
            params.set('tab', 'details');
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }
          
          // Small delay to ensure the URL is updated before opening drawer (only in non-quick view)
          const delay = quickView ? 0 : 10;
          setTimeout(() => {
            drawer.openDrawer(
              <ClientDetails
                client={client}
                documents={[]}
                contacts={[]}
                isInDrawer={true}
                quickView={true}
              />
            );
          }, delay);
        } else {
          console.error('Client not found');
        }
      } catch (error) {
        console.error('Error fetching client details:', error);
      }
    } else {
      console.log('No client associated with this contact');
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
    // In quick view mode, we don't need to handle tab changes since only Details tab is shown
    if (quickView) {
      return;
    }
    
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', tabValue);
    router.push(`${pathname}?${params.toString()}`);
  };

  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.client_id === clientId);
    return client ? client.client_name : 'Unknown Client';
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
              automationId="full-name-field"
              validate={validateContactName}
            />
            <div className="space-y-2">
              <Text as="label" size="2" className="text-gray-700 font-medium">Client</Text>
              {isEditingClient ? (
                // Show client picker when editing
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <ClientPicker
                      id="contact-client-picker"
                      onSelect={(clientId) => {
                        handleFieldChange('client_id', clientId || '');
                        setSelectedClientId(clientId);
                        setIsEditingClient(false);
                      }}
                      selectedClientId={selectedClientId}
                      clients={clients}
                      filterState={filterState}
                      onFilterStateChange={setFilterState}
                      clientTypeFilter={clientTypeFilter}
                      onClientTypeFilterChange={setClientTypeFilter}
                    />
                  </div>
                </div>
              ) : (
                // Display client with edit button
                <div className="flex items-center justify-between">
                  {editedContact.client_id ? (
                    <div className="flex items-center gap-2 py-2 cursor-pointer hover:bg-gray-50 rounded px-2 flex-1" onClick={handleClientClick}>
                      <ClientAvatar 
                        clientId={editedContact.client_id}
                        clientName={getClientName(editedContact.client_id)}
                        logoUrl={clients.find(c => c.client_id === editedContact.client_id)?.logoUrl || null}
                        size="sm"
                      />
                      <span className="text-blue-500 hover:underline text-sm">{getClientName(editedContact.client_id)}</span>
                    </div>
                  ) : (
                    <span className="text-gray-500 italic text-sm py-2 px-2">No client assigned</span>
                  )}
                  <Button
                    id="edit-client-btn"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditingClient(true)}
                    className="p-1"
                  >
                    <Pencil className="h-3 w-3 text-gray-600" />
                  </Button>
                </div>
              )}
            </div>
            <TextDetailItem
              label="Email"
              value={editedContact.email || ''}
              onEdit={(value) => handleFieldChange('email', value)}
              automationId="email-field"
              validate={validateEmailAddress}
            />
            <TextDetailItem
              label="Role"
              value={editedContact.role || ''}
              onEdit={(value) => handleFieldChange('role', value)}
              automationId="role-field"
              validate={validateRole}
            />
            <div className="space-y-2">
              <PhoneInput
                id="contact-phone-number"
                label="Phone Number"
                value={editedContact.phone_number || ''}
                onChange={(value) => handleFieldChange('phone_number', value)}
                countryCode={countryCode}
                phoneCode={countries.find(c => c.code === countryCode)?.phone_code}
                countries={countries}
                onCountryChange={handleCountryChange}
                allowExtensions={true}
                data-automation-id="phone-number-field"
              />
            </div>
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
              useInlineInput={isInDrawer}
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
              clientId={editedContact.client_id || ''}
              clientName={getClientName(editedContact.client_id || '')}
              initialBoards={ticketFormOptions.boardOptions}
              initialStatuses={ticketFormOptions.statusOptions}
              initialPriorities={ticketFormOptions.priorityOptions}
              initialCategories={ticketFormOptions.categories}
              initialTags={ticketFormOptions.tags || []}
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
            clientId={editedContact.client_id!}
            interactions={interactions}
            setInteractions={setInteractions}
          />
        </div>
      )
    },
    {
      label: "Portal",
      content: (
        <ContactPortalTab
          contact={editedContact}
          currentUserPermissions={userPermissions}
        />
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
        {!quickView && (
          <BackNav href={!isInDrawer ? "/msp/contacts" : undefined}>
            {isInDrawer ? 'Back' : 'Back to Contacts'}
          </BackNav>
        )}
        
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
        
        {isInDrawer && (
          <Button
            id={`${id}-go-to-contact-button`}
            onClick={() => window.open(`/msp/contacts/${editedContact.contact_name_id}`, '_blank')}
            variant="soft"
            size="sm"
            className="flex items-center ml-4 mr-2"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Go to contact
          </Button>
        )}

        <Button
          id={`${id}-delete-contact-button`}
          onClick={handleDeleteContact}
          variant="destructive"
          size="sm"
          className="flex items-center mr-8"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </Button>
      </div>

      {/* Content Area */}
      <div>
        <CustomTabs
          tabs={quickView ? [tabContent[0]] : tabContent}
          defaultTab={findTabLabel(searchParams?.get('tab'))}
          onTabChange={handleTabChange}
        />
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        id="delete-contact-dialog"
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        onConfirm={confirmDelete}
        title="Delete Contact"
        message={
          deleteError
            ? deleteError
            : "Are you sure you want to delete this contact? This action cannot be undone."
        }
        confirmLabel={deleteError ? undefined : (showDeactivateOption ? undefined : "Delete")}
        cancelLabel={deleteError ? "Close" : "Cancel"}
        isConfirming={false}
      />

      {/* Deactivate Contact Button - shown when delete is blocked by dependencies */}
      {showDeactivateOption && !deleteError && isDeleteDialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold mb-4">Alternative Action</h3>
            <p className="text-gray-600 mb-6">
              Since this contact cannot be deleted, you can mark it as inactive instead.
            </p>
            <div className="flex justify-end space-x-4">
              <Button
                id="cancel-deactivate-contact-btn"
                variant="outline"
                onClick={resetDeleteState}
              >
                Cancel
              </Button>
              <Button
                id="confirm-deactivate-contact-btn"
                variant="default"
                onClick={handleMarkContactInactive}
              >
                Mark as Inactive
              </Button>
            </div>
          </div>
        </div>
      )}
    </ReflectionContainer>
  );
};

export default ContactDetails;