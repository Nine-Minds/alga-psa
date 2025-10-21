'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IDocument } from 'server/src/interfaces/document.interface';
import { PartialBlock } from '@blocknote/core';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import UserPicker from 'server/src/components/ui/UserPicker';
import { TagManager } from 'server/src/components/tags';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import { FeaturePlaceholder } from '../FeaturePlaceholder';
import { findTagsByEntityId } from 'server/src/lib/actions/tagActions';
import { useTags } from 'server/src/context/TagContext';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import Documents from 'server/src/components/documents/Documents';
import { validateCompanySize, validateAnnualRevenue, validateWebsiteUrl, validateIndustry, validateClientName } from 'server/src/lib/utils/clientFormValidation';
import ClientContactsList from 'server/src/components/contacts/ClientContactsList';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Switch } from 'server/src/components/ui/Switch';
import BillingConfiguration from './BillingConfiguration';
import { updateClient, uploadClientLogo, deleteClientLogo, getClientById, deleteClient } from 'server/src/lib/actions/client-actions/clientActions';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { QuickAddTicket } from '../tickets/QuickAddTicket';
import { Button } from 'server/src/components/ui/Button';
import { ExternalLink, Trash2 } from 'lucide-react';
import BackNav from 'server/src/components/ui/BackNav';
import TaxSettingsForm from 'server/src/components/TaxSettingsForm';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from 'server/src/interfaces/interaction.interfaces';
import { useDrawer } from "server/src/context/DrawerContext";
import TimezonePicker from 'server/src/components/ui/TimezonePicker';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import ClientAssets from './ClientAssets';
import ClientTickets from './ClientTickets';
import ClientLocations from './ClientLocations';
import TextEditor, { DEFAULT_BLOCK } from '../editor/TextEditor';
import { IBoard, ITicket, ITicketCategory } from 'server/src/interfaces';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { Card } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { FormFieldComponent } from 'server/src/types/ui-reflection/types';
import { createBlockDocument, updateBlockContent, getBlockContent } from 'server/src/lib/actions/document-actions/documentBlockContentActions';
import { getDocument, getImageUrl } from 'server/src/lib/actions/document-actions/documentActions';
import ClientContractLineDashboard from '../billing-dashboard/ClientContractLineDashboard';
import { toast } from 'react-hot-toast';
import EntityImageUpload from 'server/src/components/ui/EntityImageUpload';
import { getTicketFormOptions } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { ClientLanguagePreference } from './ClientLanguagePreference';
import { useTranslation } from 'server/src/lib/i18n/client';


const SwitchDetailItem: React.FC<{
  value: boolean;
  onEdit: (value: boolean) => void;
  automationId?: string;
}> = ({ value, onEdit, automationId }) => {
  // Register for UI automation with meaningful label
  const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: automationId,
    type: 'formField',
    fieldType: 'checkbox',
    label: 'Client Status',
    value: value ? 'Active' : 'Inactive',
    helperText: 'Set client status as active or inactive'
  });

  return (
    <div className="flex items-center justify-between py-3" {...automationIdProps}>
      <div>
        <div className="text-gray-900 font-medium">Status</div>
        <div className="text-sm text-gray-500">Set client status as active or inactive</div>
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

  // Register for UI automation with meaningful label
  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    id: automationId,
    type: 'formField',
    fieldType: 'textField',
    label: label,
    value: localValue,
    helperText: `Input field for ${label}`
  });

  // Update metadata when localValue changes
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: localValue,
        label: label
      });
    }
  }, [localValue, updateMetadata, label]);

  const handleBlur = () => {
    // Professional SaaS validation pattern: validate on blur, not while typing
    if (validate) {
      const validationError = validate(localValue);
      setError(validationError);
    }

    // Always call onEdit to allow parent to determine if changes should be tracked
    onEdit(localValue);
  };
  
  return (
    <div className="space-y-2" {...automationIdProps}>
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <Input
        id={automationId ? `${automationId}-input` : undefined}
        type="text"
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          // Clear error while typing
          if (error) {
            setError(null);
          }
        }}
        onBlur={handleBlur}
        className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 transition-all duration-200 ${
          error
            ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
            : 'border-gray-200 focus:ring-purple-500 focus:border-transparent'
        }`}
      />
      {error && (
        <Text size="1" className="text-red-600 mt-1">{error}</Text>
      )}
    </div>
  );
};

interface ClientDetailsProps {
  id?: string;
  client: IClient;
  documents?: IDocument[];
  contacts?: IContact[];
  isInDrawer?: boolean;
  quickView?: boolean;
}

const ClientDetails: React.FC<ClientDetailsProps> = ({
  id = 'client-details',
  client,
  documents = [],
  contacts = [],
  isInDrawer = false,
  quickView = false
}) => {
  const { t } = useTranslation('common');
  const featureFlag = useFeatureFlag('billing-enabled');
  const isBillingEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;
  const [editedClient, setEditedClient] = useState<IClient>(client);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);
  const [internalUsers, setInternalUsers] = useState<IUserWithRoles[]>([]);
  
  // Update editedClient when client prop changes
  useEffect(() => {
    setEditedClient(client);
  }, [client]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isDocumentSelectorOpen, setIsDocumentSelectorOpen] = useState(false);
  const [hasUnsavedNoteChanges, setHasUnsavedNoteChanges] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isDeletingLogo, setIsDeletingLogo] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeactivateOption, setShowDeactivateOption] = useState(false);
  const [isEditingLogo, setIsEditingLogo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentContent, setCurrentContent] = useState<PartialBlock[]>(DEFAULT_BLOCK);
  const [noteDocument, setNoteDocument] = useState<IDocument | null>(null);
  const [ticketFormOptions, setTicketFormOptions] = useState<{
    statusOptions: SelectOption[];
    priorityOptions: SelectOption[];
    boardOptions: IBoard[];
    categories: ITicketCategory[];
    tags?: string[];
  } | null>(null);
  const [isLocationsDialogOpen, setIsLocationsDialogOpen] = useState(false);
  const [tags, setTags] = useState<ITag[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const { tags: allTags } = useTags();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawer = useDrawer();


  const handleDeleteClient = () => {
    setDeleteError(null);
    setShowDeactivateOption(false);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    try {
      const result = await deleteClient(editedClient.client_id);

      if (!result.success) {
        if ('code' in result && result.code === 'COMPANY_HAS_DEPENDENCIES') {
          handleDependencyError(result, setDeleteError);
          setShowDeactivateOption(true);
          return;
        }
        throw new Error(result.message || 'Failed to delete client');
      }

      setIsDeleteDialogOpen(false);

      toast.success("Client has been deleted successfully.");

      // Navigate back or close drawer depending on context
      if (isInDrawer) {
        drawer.closeDrawer();
      } else {
        router.push('/msp/clients');
      }
    } catch (error: any) {
      console.error('Failed to delete client:', error);
      setDeleteError(error.message || 'Failed to delete client. Please try again.');
    }
  };

  const handleMarkClientInactive = async () => {
    try {
      await updateClient(editedClient.client_id, { is_inactive: true });

      setIsDeleteDialogOpen(false);

      toast.success("Client has been marked as inactive successfully.");

      // Navigate back or close drawer depending on context
      if (isInDrawer) {
        drawer.closeDrawer();
      } else {
        router.push('/msp/clients');
      }
    } catch (error: any) {
      console.error('Error marking client as inactive:', error);
      setDeleteError('An error occurred while marking the client as inactive. Please try again.');
    }
  };

  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setDeleteError(null);
    setShowDeactivateOption(false);
  };

  // Helper function to handle dependency errors (copied from main Clients page)
  const handleDependencyError = (result: any, setError: (error: string) => void) => {
    const dependencies = result.dependencies || {};
    const dependencyMessages: string[] = [];

    if (dependencies.tickets > 0) {
      dependencyMessages.push(`${dependencies.tickets} ticket${dependencies.tickets !== 1 ? 's' : ''}`);
    }
    if (dependencies.contacts > 0) {
      dependencyMessages.push(`${dependencies.contacts} contact${dependencies.contacts !== 1 ? 's' : ''}`);
    }
    if (dependencies.projects > 0) {
      dependencyMessages.push(`${dependencies.projects} project${dependencies.projects !== 1 ? 's' : ''}`);
    }

    if (dependencyMessages.length > 0) {
      const dependencyText = dependencyMessages.join(', ');
      setError(`Cannot delete this client because it has associated ${dependencyText}. You can mark the client as inactive instead.`);
    } else {
      setError('Cannot delete this client because it has associated data. You can mark the client as inactive instead.');
    }
  };

  // 1. Implement refreshClientData function
  const refreshClientData = useCallback(async () => {
    if (!client?.client_id) return; // Ensure client_id is available

    try {
      const latestClientData = await getClientById(client.client_id);
      if (latestClientData) {
        setEditedClient(latestClientData);
      }
    } catch (error) {
      console.error('Error refreshing client data:', error);
      toast.error("Could not fetch latest client data.");
    }
  }, [client?.client_id]);

  // 2. Implement Initial Load Logic
  useEffect(() => {
    // Set initial state when the client prop changes
    setEditedClient({
      ...client,
      // Ensure client_type has a value
      client_type: client.client_type || 'company'
    });
    // Reset unsaved changes flag when client prop changes
    setHasUnsavedChanges(false);
  }, [client]); // Dependency on the client prop
  
  useEffect(() => {
    if (editedClient?.logoUrl !== client?.logoUrl) {
      // Logo URL has changed
    }
  }, [editedClient?.logoUrl, client?.logoUrl]);

  // Existing useEffect for fetching user and users
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };
    const fetchAllUsers = async () => {
      if (internalUsers.length > 0) return;
      setIsLoadingUsers(true);
      try {
        const users = await getAllUsers();
        setInternalUsers(users);
      } catch (error) {
        console.error("Error fetching MSP users:", error);
      } finally {
        setIsLoadingUsers(false);
      }
    };

    fetchUser();
    fetchAllUsers();
  }, [internalUsers.length]);

  // Separate useEffect for ticket form options
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

  // Fetch tags when component mounts
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const clientTags = await findTagsByEntityId(client.client_id, 'client');
        setTags(clientTags);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [client.client_id]);

  // Load note content and document metadata when component mounts
  useEffect(() => {
    const loadNoteContent = async () => {
      if (editedClient.notes_document_id) {
        try {
          const document = await getDocument(editedClient.notes_document_id);
          setNoteDocument(document);
          const content = await getBlockContent(editedClient.notes_document_id);
          if (content && content.block_data) {
            const blockData = typeof content.block_data === 'string'
              ? JSON.parse(content.block_data)
              : content.block_data;
            setCurrentContent(blockData);
          } else {
             setCurrentContent(DEFAULT_BLOCK);
          }
        } catch (error) {
          console.error('Error loading note content:', error);
           setCurrentContent(DEFAULT_BLOCK);
        }
      } else {
         setCurrentContent(DEFAULT_BLOCK);
         setNoteDocument(null);
      }
    };

    loadNoteContent();
  }, [editedClient.notes_document_id]);


  const handleFieldChange = (field: string, value: string | boolean) => {
    setEditedClient(prevClient => {
      // Create a deep copy of the previous client
      const updatedClient = JSON.parse(JSON.stringify(prevClient)) as IClient;
      
      if (field.startsWith('properties.') && field !== 'properties.account_manager_id') {
        const propertyField = field.split('.')[1];
        
        // Ensure properties object exists
        if (!updatedClient.properties) {
          updatedClient.properties = {};
        }
        
        // Update the specific property using type assertion
        (updatedClient.properties as any)[propertyField] = value;
        
        // Sync url with properties.website when website is updated
        if (propertyField === 'website' && typeof value === 'string') {
          updatedClient.url = value;
        }
      } else if (field === 'url') {
        // Update the URL field
        updatedClient.url = value as string;
        
        // Sync properties.website with url
        if (!updatedClient.properties) {
          updatedClient.properties = {};
        }
        
        // Use type assertion to set the website property
        (updatedClient.properties as any).website = value as string;
      } else {
        // For all other fields, use type assertion to update directly
        (updatedClient as any)[field] = value;
      }
      
      return updatedClient;
    });
    
    // Check if the updated client matches the original client
    setHasUnsavedChanges(() => {
      // Create a temporary copy to compare
      const tempClient = JSON.parse(JSON.stringify(editedClient)) as IClient;
      
      // Apply the change to temp client for comparison
      if (field.startsWith('properties.') && field !== 'properties.account_manager_id') {
        const propertyField = field.split('.')[1];
        if (!tempClient.properties) {
          tempClient.properties = {};
        }
        (tempClient.properties as any)[propertyField] = value;
        if (propertyField === 'website' && typeof value === 'string') {
          tempClient.url = value;
        }
      } else if (field === 'url') {
        tempClient.url = value as string;
        if (!tempClient.properties) {
          tempClient.properties = {};
        }
        (tempClient.properties as any).website = value as string;
      } else {
        (tempClient as any)[field] = value;
      }
      
      // Compare with original client to determine if there are unsaved changes
      return JSON.stringify(tempClient) !== JSON.stringify(client);
    });
  };

  const handleSave = async () => {
    if (isSaving) return;
    setHasAttemptedSubmit(true);

    // Professional PSA validation pattern: Check required fields
    const requiredFields = {
      client_name: editedClient.client_name?.trim() || ''
    };

    // Clear previous errors and validate required fields
    const newErrors: Record<string, string> = {};
    let hasValidationErrors = false;

    Object.entries(requiredFields).forEach(([field, value]) => {
      if (field === 'client_name') {
        const error = validateClientName(value);
        if (error) {
          newErrors[field] = error;
          hasValidationErrors = true;
        }
      }
    });

    setFieldErrors(newErrors);

    if (hasValidationErrors) {
      setIsSaving(false);
      return;
    }

    setIsSaving(true);
    try {
      // Prepare data for update, removing computed fields
      const {
        account_manager_full_name,
        ...restOfEditedClient 
      } = editedClient;
      const dataToUpdate: Partial<Omit<IClient, 'account_manager_full_name'>> = {
        ...restOfEditedClient,
        properties: restOfEditedClient.properties ? { ...restOfEditedClient.properties } : {},
        account_manager_id: editedClient.account_manager_id === '' ? null : editedClient.account_manager_id,
      };
      const updatedClientResult = await updateClient(client.client_id, dataToUpdate);
      // Assuming updateClient returns the full updated client object matching IClient
      const updatedClient = updatedClientResult as IClient; // Cast if necessary, or adjust based on actual return type
      setEditedClient(updatedClient);
      setHasUnsavedChanges(false);
      setHasAttemptedSubmit(false);
      toast.success("Client details saved successfully.");
    } catch (error) {
      console.error('Error saving client:', error);
      toast.error("Failed to save client details. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleBillingConfigSave = async (updatedBillingConfig: Partial<IClient>) => {
    try {
      const updatedClient = await updateClient(client.client_id, updatedBillingConfig);
      setEditedClient(prevClient => {
        const newClient = { ...prevClient };
        Object.keys(updatedBillingConfig).forEach(key => {
          (newClient as any)[key] = (updatedClient as any)[key];
        });
        return newClient;
      });
    } catch (error) {
      console.error('Error updating client:', error);
    }
  };

  const handleTicketAdded = (ticket: ITicket) => {
    setIsQuickAddTicketOpen(false);
  };

  const handleInteractionAdded = (newInteraction: IInteraction) => {
    setInteractions(prevInteractions => {
      const updatedInteractions = [newInteraction, ...prevInteractions];
      return updatedInteractions.filter((interaction, index, self) =>
        index === self.findIndex((t) => t.interaction_id === interaction.interaction_id)
      );
    });
  };

  const handleTagsChange = (updatedTags: ITag[]) => {
    setTags(updatedTags);
  };

  const handleContentChange = (blocks: PartialBlock[]) => {
    setCurrentContent(blocks);
    setHasUnsavedNoteChanges(true);
  };

  const handleSaveNote = async () => {
    try {
      if (!currentUser) {
        console.error('Cannot save note: No current user');
        return;
      }

      // Convert blocks to JSON string
      const blockData = JSON.stringify(currentContent);
      
      if (editedClient.notes_document_id) {
        // Update existing note document
        await updateBlockContent(editedClient.notes_document_id, {
          block_data: blockData,
          user_id: currentUser.user_id
        });
        
        // Refresh document metadata to show updated timestamp
        const updatedDocument = await getDocument(editedClient.notes_document_id);
        setNoteDocument(updatedDocument);
      } else {
        // Create new note document
        const { document_id } = await createBlockDocument({
          document_name: `${editedClient.client_name} Notes`,
          user_id: currentUser.user_id,
          block_data: blockData,
          entityId: editedClient.client_id,
          entityType: 'client'
        });
        
        // Update client with the new notes_document_id
        await updateClient(editedClient.client_id, {
          notes_document_id: document_id
        });
        
        // Update local state
        setEditedClient(prev => ({
          ...prev,
          notes_document_id: document_id
        }));
        
        // Get the newly created document metadata
        const newDocument = await getDocument(document_id);
        setNoteDocument(newDocument);
      }
      
      setHasUnsavedNoteChanges(false);
      toast.success("Note saved successfully.");
    } catch (error) {
      console.error('Error saving note:', error);
      toast.error("Failed to save note. Please try again.");
    }
  };
  

  const handleTabChange = async (tabValue: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', tabValue);
    router.push(`${pathname}?${params.toString()}`);
  };

  const tabContent = [
    {
      label: "Details",
      content: (
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column - All Form Fields */}
            <div className="space-y-6">
              <TextDetailItem
                label="Client Name"
                value={editedClient.client_name}
                onEdit={(value) => handleFieldChange('client_name', value)}
                automationId="client-name-field"
                validate={validateClientName}
              />
                           
              <FieldContainer
                label="Account Manager"
                fieldType="select"
                value={editedClient.account_manager_full_name || ''}
                helperText="Select the account manager for this client"
                automationId="account-manager-field"
              >
                <Text as="label" size="2" className="text-gray-700 font-medium">Account Manager</Text>
                <UserPicker
                  value={editedClient.account_manager_id || ''}
                  onValueChange={(value) => handleFieldChange('account_manager_id', value)}
                  users={internalUsers}
                  disabled={isLoadingUsers}
                  placeholder={isLoadingUsers ? "Loading users..." : "Select Account Manager"}
                  buttonWidth="full"
                />
              </FieldContainer>
              
              <TextDetailItem
                label="Website"
                value={editedClient.properties?.website || ''}
                onEdit={(value) => handleFieldChange('properties.website', value)}
                automationId="website-field"
                validate={validateWebsiteUrl}
              />

              <TextDetailItem
                label="Industry"
                value={editedClient.properties?.industry || ''}
                onEdit={(value) => handleFieldChange('properties.industry', value)}
                automationId="industry-field"
                validate={validateIndustry}
              />

              <TextDetailItem
                label="Company Size"
                value={editedClient.properties?.company_size || ''}
                onEdit={(value) => handleFieldChange('properties.company_size', value)}
                automationId="company-size-field"
                validate={validateCompanySize}
              />
              
              <TextDetailItem
                label="Annual Revenue"
                value={editedClient.properties?.annual_revenue || ''}
                onEdit={(value) => handleFieldChange('properties.annual_revenue', value)}
                automationId="annual-revenue-field"
                validate={validateAnnualRevenue}
              />

              {/* Language Preference */}
              <div className="space-y-2">
                <ClientLanguagePreference
                  clientId={editedClient.client_id}
                  clientName={editedClient.client_name}
                  showCard={false}
                />
              </div>

              {/* Status and Client Type in 2 columns */}
              <div className="grid grid-cols-5 gap-4">

                {/* Client Type */}
                <div className="space-y-2 col-span-2">
                  <Text as="label" size="2" className="text-gray-700 font-medium">Client Type</Text>
                  <CustomSelect
                    id="client-type-select"
                    value={editedClient.client_type || 'company'}
                    onValueChange={(value) => handleFieldChange('client_type', value)}
                    options={[
                      { value: 'company', label: 'Company' },
                      { value: 'individual', label: 'Individual' }
                    ]}
                    placeholder="Select client type"
                    className="!w-fit"
                  />
                </div>
                <div className="col-span-3">
                  <SwitchDetailItem
                    value={!editedClient.is_inactive || false}
                    onEdit={(isActive) => handleFieldChange('is_inactive', !isActive)}
                    automationId="client-status-field"
                  />
                </div>
              </div>

              {/* Tags */}
              <div className="space-y-2">
                <Text as="label" size="2" className="text-gray-700 font-medium">Tags</Text>
                <TagManager
                  id={`${id}-tags`}
                  entityId={editedClient.client_id}
                  entityType="client"
                  initialTags={tags}
                  onTagsChange={handleTagsChange}
                  useInlineInput={isInDrawer}
                />
              </div>
            </div>
            
            {/* Right Column - Client Locations Only */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Text as="label" size="2" className="text-gray-700 font-medium">{t('clients.locations.sectionTitle', 'Client Locations')}</Text>
                <Button
                  id="locations-button"
                  size="sm"
                  variant="outline"
                  onClick={() => setIsLocationsDialogOpen(true)}
                  className="text-sm"
                >
                  {t('clients.locations.manageButton', 'Manage Locations')}
                </Button>
              </div>
              <div>
                <ClientLocations 
                  clientId={editedClient.client_id} 
                  isEditing={false}
                />
              </div>
            </div>
          </div>
          
          <Flex gap="4" justify="end" align="center" className="pt-6">
            {hasAttemptedSubmit && Object.keys(fieldErrors).some(key => fieldErrors[key]) && (
              <Text size="2" className="text-red-600 mr-2" role="alert">
                Please fill in all required fields
              </Text>
            )}
            <Button
              id="save-client-changes-btn"
              onClick={handleSave}
              disabled={isSaving}
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button
              id="add-ticket-btn"
              onClick={() => setIsQuickAddTicketOpen(true)}
              variant="default"
            >
              Add Ticket
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
            <ClientTickets 
              clientId={client.client_id}
              clientName={client.client_name}
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
    // {
    //   label: "Assets",
    //   content: (
    //     <ClientAssets clientId={client.client_id} />
    //   )
    // },
    {
      label: "Billing",
      content: isBillingEnabled ? (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <BillingConfiguration
            client={editedClient}
            onSave={handleBillingConfigSave}
            contacts={contacts}
          />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden h-full">
          <FeaturePlaceholder />
        </div>
      )
    },
    {
      label: "Billing Dashboard",
      content: isBillingEnabled ? (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <ClientContractLineDashboard clientId={client.client_id} />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden h-full">
          <FeaturePlaceholder />
        </div>
      )
    },
    {
      label: "Contacts",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <ClientContactsList
            clientId={client.client_id}
            clients={[client]}
          />
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
              entityId={client.client_id}
              entityType="client"
              onDocumentCreated={async () => {
                return Promise.resolve();
              }}
            />
          ) : (
            <div>Loading...</div>
          )}
        </div>
      )
    },
    {
      label: "Tax Settings",
      content: isBillingEnabled ? (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <TaxSettingsForm clientId={client.client_id} />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden h-full">
          <FeaturePlaceholder />
        </div>
      )
    },
    {
      label: "Additional Info",
      content: (
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <TextDetailItem
              label="Tax ID"
              value={editedClient.properties?.tax_id ?? ""}
              onEdit={(value) => handleFieldChange('properties.tax_id', value)}
              automationId="tax-id-field"
            />
            <TextDetailItem
              label="Payment Terms"
              value={editedClient.properties?.payment_terms ?? ""}
              onEdit={(value) => handleFieldChange('properties.payment_terms', value)}
              automationId="payment-terms-field"
            />
            <TextDetailItem
              label="Parent Client"
              value={editedClient.properties?.parent_client_name ?? ""}
              onEdit={(value) => handleFieldChange('properties.parent_client_name', value)}
              automationId="parent-client-field"
            />
            <FieldContainer
              label="Timezone"
              fieldType="select"
              value={editedClient.timezone || ''}
              helperText="Select the timezone for this client"
              automationId="timezone-field"
            >
              <Text as="label" size="2" className="text-gray-700 font-medium">Timezone</Text>
              <TimezonePicker
                value={editedClient.timezone ?? ""}
                onValueChange={(value) => handleFieldChange('timezone', value)}
              />
            </FieldContainer>
            <TextDetailItem
              label="Last Contact Date"
              value={editedClient.properties?.last_contact_date ?? ""}
              onEdit={(value) => handleFieldChange('properties.last_contact_date', value)}
              automationId="last-contact-date-field"
            />
          </div>
          
          <Flex gap="4" justify="end" align="center">
            {hasAttemptedSubmit && Object.keys(fieldErrors).some(key => fieldErrors[key]) && (
              <Text size="2" className="text-red-600 mr-2" role="alert">
                Please fill in all required fields
              </Text>
            )}
            <Button
              id="save-additional-info-btn"
              onClick={handleSave}
              disabled={isSaving}
              className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </Flex>
        </div>
      )
    },
    {
      label: "Notes",
      content: (
        <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
          {editedClient.notes && editedClient.notes.trim() !== '' && (
            <div className="bg-gray-100 border border-gray-200 rounded-md p-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Initial Note</h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{editedClient.notes}</p>
            </div>
          )}

          {/* Rich Text Editor Section Label */}
          <h4 className="text-md font-semibold text-gray-800 pt-2">Formatted Notes</h4>

          {/* Note metadata */}
          {noteDocument && noteDocument.updated_at && (
            <div className="bg-gray-50 p-3 rounded-md border border-gray-200 text-xs text-gray-600">
              <div className="flex justify-between items-center flex-wrap gap-2"> 
                <div>
                  <span className="font-medium">Last updated:</span> {new Date(noteDocument.updated_at).toLocaleDateString()} at {new Date(noteDocument.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )}

          <TextEditor
            id={`${id}-editor`}
            initialContent={currentContent}
            onContentChange={handleContentChange}
          />
          <div className="flex justify-end space-x-2">
            <Button
              id={`${id}-save-note-btn`}
              onClick={handleSaveNote}
              disabled={!hasUnsavedNoteChanges}
              className={`text-white transition-colors ${
                hasUnsavedNoteChanges
                  ? "bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))]"
                  : "bg-[rgb(var(--color-border-400))] cursor-not-allowed"
              }`}
            >
              Save Note
            </Button>
          </div>
        </div>
      )
    },
    {
      label: "Interactions",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <InteractionsFeed
            entityId={client.client_id}
            entityType="client"
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
    <ReflectionContainer id={id} label="Client Details">
      <div className="flex items-center space-x-5 mb-4 pt-2">
        {!quickView && (
          <BackNav href="/msp/clients">
            {isInDrawer ? 'Back' : 'Back to Clients'}
          </BackNav>
        )}
        
        {/* Logo Display and Edit Container */}
        <div className="flex items-center space-x-3">
          <EntityImageUpload
            entityType="client"
            entityId={editedClient.client_id}
            entityName={editedClient.client_name}
            imageUrl={editedClient.logoUrl ?? null}
            uploadAction={uploadClientLogo}
            deleteAction={deleteClientLogo}
            onImageChange={async (newLogoUrl) => {
              setEditedClient(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  logoUrl: newLogoUrl
                };
              });
              
              // If logo was deleted (newLogoUrl is null), refresh client data to ensure consistency
              if (newLogoUrl === null) {
                await refreshClientData();
              }
            }}
            size="md"
          />
        </div>

        <div className="flex-1 flex items-center justify-between">
          <Heading size="6" tabIndex={quickView ? 0 : undefined} autoFocus={quickView}>
            {editedClient.client_name}
          </Heading>
          
          {isInDrawer && (
            <Button
              id={`${id}-open-in-new-tab-button`}
              onClick={() => window.open(`/msp/clients/${editedClient.client_id}`, '_blank')}
              variant="soft"
              size="sm"
              className="flex items-center ml-4 mr-2"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in new tab
            </Button>
          )}

          <Button
            id={`${id}-delete-client-button`}
            onClick={handleDeleteClient}
            variant="destructive"
            size="sm"
            className="flex items-center mr-8"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Content Area */}
      <div>
        <CustomTabs
          tabs={quickView ? [tabContent[0]] : tabContent}
          // In quick view we only render the Details tab. Force default to Details
          // to avoid a mismatch with the current page's ?tab= query (e.g. "Tickets").
          defaultTab={quickView ? 'Details' : findTabLabel(searchParams?.get('tab'))}
          onTabChange={handleTabChange}
        />

        <QuickAddTicket
          id={`${id}-quick-add-ticket`}
          open={isQuickAddTicketOpen}
          onOpenChange={setIsQuickAddTicketOpen}
          onTicketAdded={handleTicketAdded}
          prefilledClient={{
            id: editedClient.client_id,
            name: editedClient.client_name
          }}
        />

        <Dialog 
          isOpen={isLocationsDialogOpen} 
          onClose={() => setIsLocationsDialogOpen(false)} 
          title={t('clients.locations.dialogTitle', 'Manage Locations', { client: editedClient.client_name })}
        >
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <ClientLocations 
              clientId={editedClient.client_id} 
              isEditing={true}
            />
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <ConfirmationDialog
          id="delete-client-dialog"
          isOpen={isDeleteDialogOpen}
          onClose={resetDeleteState}
          onConfirm={confirmDelete}
          title="Delete Client"
          message={
            deleteError
              ? deleteError
              : "Are you sure you want to delete this client? This action cannot be undone."
          }
          confirmLabel={deleteError ? undefined : (showDeactivateOption ? undefined : "Delete")}
          cancelLabel={deleteError ? "Close" : "Cancel"}
          isConfirming={false}
        />
      </div>
    </ReflectionContainer>
  );
};

const FieldContainer: React.FC<{
  label: string;
  fieldType: 'select' | 'textField';
  value: string;
  helperText: string;
  automationId?: string;
  children: React.ReactNode;
}> = ({ label, fieldType, value, helperText, automationId, children }) => {
  const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType,
    label,
    value,
    helperText
  }, true, automationId);

  return (
    <div className="space-y-2" {...automationIdProps}>
      {children}
    </div>
  );
};

export default ClientDetails;
