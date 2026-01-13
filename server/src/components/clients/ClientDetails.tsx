'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import UserPicker from 'server/src/components/ui/UserPicker';
import { TagManager } from 'server/src/components/tags';
import { findTagsByEntityId } from 'server/src/lib/actions/tagActions';
import { useTags } from 'server/src/context/TagContext';
import { getAllUsersBasic } from 'server/src/lib/actions/user-actions/userActions';
import { BillingCycleType } from 'server/src/interfaces/billing.interfaces';
import Documents from 'server/src/components/documents/Documents';
import { validateCompanySize, validateAnnualRevenue, validateWebsiteUrl, validateIndustry, validateClientName } from 'server/src/lib/utils/clientFormValidation';
import ClientContactsList from 'server/src/components/contacts/ClientContactsList';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Switch } from 'server/src/components/ui/Switch';
import BillingConfiguration from './BillingConfiguration';
import { updateClient, uploadClientLogo, deleteClientLogo, getClientById, deleteClient, reactivateClientContacts, deactivateClientContacts, markClientInactiveWithContacts, markClientActiveWithContacts } from 'server/src/lib/actions/client-actions/clientActions';
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
import { IUser } from '@shared/interfaces/user.interfaces';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import ClientAssets from './ClientAssets';
import ClientTickets from './ClientTickets';
import ClientLocations from './ClientLocations';
import { IBoard, ITicket, ITicketCategory } from 'server/src/interfaces';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { Card } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { FormFieldComponent } from 'server/src/types/ui-reflection/types';
import { getImageUrl } from 'server/src/lib/actions/document-actions/documentActions';
import ClientContractLineDashboard from '../billing-dashboard/ClientContractLineDashboard';
import { ClientNotesPanel } from './panels/ClientNotesPanel';
import { toast } from 'react-hot-toast';
import { handleError } from 'server/src/lib/utils/errorHandling';
import EntityImageUpload from 'server/src/components/ui/EntityImageUpload';
import { getTicketFormOptions } from 'server/src/lib/actions/ticket-actions/optimizedTicketActions';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { ClientLanguagePreference } from './ClientLanguagePreference';
import { useTranslation } from 'server/src/lib/i18n/client';
import ClientSurveySummaryCard from 'server/src/components/surveys/ClientSurveySummaryCard';
import type { SurveyClientSatisfactionSummary } from 'server/src/interfaces/survey.interface';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';


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
  surveySummary?: SurveyClientSatisfactionSummary | null;
}

const ClientDetails: React.FC<ClientDetailsProps> = ({
  id = 'client-details',
  client,
  documents = [],
  contacts = [],
  isInDrawer = false,
  quickView = false,
  surveySummary = null
}) => {
  const { t } = useTranslation('common');
  const [editedClient, setEditedClient] = useState<IClient>(client);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [currentUser, setCurrentUser] = useState<IUser | null>(null);
  const [internalUsers, setInternalUsers] = useState<IUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isDocumentSelectorOpen, setIsDocumentSelectorOpen] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isDeletingLogo, setIsDeletingLogo] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeactivateOption, setShowDeactivateOption] = useState(false);
  const [deleteDependencies, setDeleteDependencies] = useState<{
    contacts?: number;
    tickets?: number;
    projects?: number;
    invoices?: number;
    documents?: number;
    interactions?: number;
    assets?: number;
    service_usage?: number;
    bucket_usage?: number;
  } | null>(null);
  const [isReactivateDialogOpen, setIsReactivateDialogOpen] = useState(false);
  const [inactiveContactsToReactivate, setInactiveContactsToReactivate] = useState<IContact[]>([]);
  const [isDeactivateDialogOpen, setIsDeactivateDialogOpen] = useState(false);
  const [activeContactsToDeactivate, setActiveContactsToDeactivate] = useState<IContact[]>([]);
  const [isEditingLogo, setIsEditingLogo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ticketFormOptions, setTicketFormOptions] = useState<{
    statusOptions: SelectOption[];
    priorityOptions: SelectOption[];
    boardOptions: IBoard[];
    categories: ITicketCategory[];
    tags?: string[];
  } | null>(null);
  const [isLocationsDialogOpen, setIsLocationsDialogOpen] = useState(false);
  const [locationsRefreshKey, setLocationsRefreshKey] = useState(0);
  const [tags, setTags] = useState<ITag[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const { tags: allTags } = useTags();
  const router = useRouter();
  const memoizedRouter = useMemo(() => router, [router]);
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
          handleDependencyError(result);
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
      const errorMessage = error.message || 'Failed to delete client. Please try again.';
      // Only set the error in state - dialog already displays it, avoid duplicate toast
      setDeleteError(errorMessage);
    }
  };

  // Handler for deactivating client from the delete dialog (deactivates all contacts)
  const handleMarkClientInactiveAll = async () => {
    try {
      // Use atomic action to deactivate client AND all contacts
      const result = await markClientInactiveWithContacts(editedClient.client_id, true);

      if (!result.success) {
        handleError(new Error(result.message || 'Failed to mark client as inactive'));
        resetDeleteState();
        return;
      }

      // Update local state immediately
      setEditedClient(prev => ({ ...prev, is_inactive: true }));

      if (result.contactsDeactivated > 0) {
        toast.success(`Client and ${result.contactsDeactivated} contact${result.contactsDeactivated !== 1 ? 's' : ''} have been deactivated successfully.`);
      } else {
        toast.success("Client has been marked as inactive successfully.");
      }

      // Close dialog first, then refresh in background
      resetDeleteState();
      router.refresh();
    } catch (error: any) {
      handleError(error, 'An error occurred while marking the client as inactive. Please try again.');
      resetDeleteState();
    }
  };

  // Handler for deactivating client from the delete dialog (client only)
  const handleMarkClientInactiveOnly = async () => {
    try {
      // Use atomic action to deactivate client only
      const result = await markClientInactiveWithContacts(editedClient.client_id, false);

      if (!result.success) {
        handleError(new Error(result.message || 'Failed to mark client as inactive'));
        resetDeleteState();
        return;
      }

      // Update local state immediately
      setEditedClient(prev => ({ ...prev, is_inactive: true }));
      toast.success("Client has been marked as inactive successfully.");

      // Close dialog first, then refresh in background
      resetDeleteState();
      router.refresh();
    } catch (error: any) {
      handleError(error, 'An error occurred while marking the client as inactive. Please try again.');
      resetDeleteState();
    }
  };

  // Handler for the direct "Mark as Inactive" button (not from delete dialog)
  const handleDirectMarkInactive = async () => {
    try {
      // Fetch active contacts for this client
      const { getContactsByClient } = await import('server/src/lib/actions/contact-actions/contactActions');
      const activeContacts = await getContactsByClient(editedClient.client_id, 'active');

      if (activeContacts.length > 0) {
        setActiveContactsToDeactivate(activeContacts);
        setIsDeactivateDialogOpen(true);
      } else {
        // No contacts to warn about, use atomic action to deactivate the client
        const result = await markClientInactiveWithContacts(editedClient.client_id, false);

        if (!result.success) {
          handleError(new Error(result.message || 'Failed to mark client as inactive'));
          return;
        }

        // Update local state immediately
        setEditedClient(prev => ({ ...prev, is_inactive: true }));
        toast.success("Client has been marked as inactive successfully.");
        router.refresh();
      }
    } catch (error: any) {
      handleError(error, 'An error occurred while marking the client as inactive. Please try again.');
    }
  };

  // Handler for the direct "Reactivate" button
  const handleDirectReactivate = async () => {
    try {
      // Fetch inactive contacts for this client
      const { getContactsByClient } = await import('server/src/lib/actions/contact-actions/contactActions');
      const inactiveContacts = await getContactsByClient(editedClient.client_id, 'inactive');

      if (inactiveContacts.length > 0) {
        setInactiveContactsToReactivate(inactiveContacts);
        setIsReactivateDialogOpen(true);
      } else {
        // No contacts to ask about, use atomic action to reactivate the client
        const result = await markClientActiveWithContacts(editedClient.client_id, false);

        if (!result.success) {
          handleError(new Error(result.message || 'Failed to reactivate client'));
          return;
        }

        // Update local state immediately
        setEditedClient(prev => ({ ...prev, is_inactive: false }));
        toast.success("Client has been reactivated successfully.");
        router.refresh();
      }
    } catch (error: any) {
      handleError(error, 'An error occurred while reactivating the client. Please try again.');
    }
  };

  const handleReactivateClient = async (reactivateContacts: boolean) => {
    try {
      // Use atomic server action to reactivate client and optionally contacts in a single transaction
      const result = await markClientActiveWithContacts(editedClient.client_id, reactivateContacts);

      if (!result.success) {
        handleError(new Error(result.message || 'Failed to reactivate client'));
        setIsReactivateDialogOpen(false);
        return;
      }

      // Update local state immediately
      setEditedClient(prev => ({ ...prev, is_inactive: false }));
      setHasUnsavedChanges(false);

      if (reactivateContacts && result.contactsReactivated > 0) {
        toast.success(`Client and ${result.contactsReactivated} contact(s) have been reactivated successfully.`);
      } else {
        toast.success('Client has been reactivated successfully.');
      }

      setIsReactivateDialogOpen(false);
      router.refresh();
    } catch (error: any) {
      handleError(error, 'An error occurred while reactivating the client. Please try again.');
    }
  };

  const handleCancelReactivation = () => {
    setIsReactivateDialogOpen(false);
    // Keep the client inactive - no changes
  };

  const handleDeactivateClient = async (deactivateContacts: boolean) => {
    try {
      // Use atomic server action to deactivate client and optionally contacts in a single transaction
      const result = await markClientInactiveWithContacts(editedClient.client_id, deactivateContacts);

      if (!result.success) {
        handleError(new Error(result.message || 'Failed to deactivate client'));
        setIsDeactivateDialogOpen(false);
        return;
      }

      // Update local state immediately
      setEditedClient(prev => ({ ...prev, is_inactive: true }));
      setHasUnsavedChanges(false);

      if (deactivateContacts && result.contactsDeactivated > 0) {
        toast.success(`Client and ${result.contactsDeactivated} contact(s) have been deactivated successfully.`);
      } else {
        toast.success('Client has been marked as inactive successfully.');
      }

      setIsDeactivateDialogOpen(false);
      router.refresh();
    } catch (error: any) {
      handleError(error, 'An error occurred while deactivating the client. Please try again.');
    }
  };

  const handleCancelDeactivation = () => {
    setIsDeactivateDialogOpen(false);
    // Keep the client active - no changes
  };

  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setDeleteError(null);
    setShowDeactivateOption(false);
    setDeleteDependencies(null);
  };

  // Helper function to handle dependency errors (copied from main Clients page)
  const handleDependencyError = (result: any) => {
    // Use counts from the result which contains: contact, ticket, project, invoice, etc.
    // Only include counts that are > 0
    const counts = result.counts || {};
    setDeleteDependencies({
      contacts: counts['contact'] > 0 ? counts['contact'] : undefined,
      tickets: counts['ticket'] > 0 ? counts['ticket'] : undefined,
      projects: counts['project'] > 0 ? counts['project'] : undefined,
      invoices: counts['invoice'] > 0 ? counts['invoice'] : undefined,
      documents: counts['document'] > 0 ? counts['document'] : undefined,
      interactions: counts['interaction'] > 0 ? counts['interaction'] : undefined,
      assets: counts['asset'] > 0 ? counts['asset'] : undefined,
      service_usage: counts['service_usage'] > 0 ? counts['service_usage'] : undefined,
      bucket_usage: counts['bucket_usage'] > 0 ? counts['bucket_usage'] : undefined,
    });
  };

  // 1. Implement refreshClientData function
  const refreshClientData = useCallback(async () => {
    if (!client?.client_id) return;

    try {
      const latestClientData = await getClientById(client.client_id);
      if (latestClientData) {
        setEditedClient({
          ...latestClientData,
          client_type: latestClientData.client_type || 'company'
        });
        setHasUnsavedChanges(false);
      }
    } catch (error) {
      console.error('Error refreshing client data:', error);
      toast.error("Could not fetch latest client data.");
    }
  }, [client?.client_id]);

  // Combined Initial Load Logic
  useEffect(() => {
    setEditedClient({
      ...client,
      client_type: client.client_type || 'company'
    });
    setHasUnsavedChanges(false);
  }, [client]);

  // Fetch current user once on mount
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser();
        if (user) {
          setCurrentUser(prev => (prev?.user_id === user.user_id ? prev : user));
        }
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };
    fetchUser();
  }, []);

  // Fetch MSP users once or when needed
  useEffect(() => {
    const fetchAllUsers = async () => {
      if (internalUsers.length > 0) return;
      setIsLoadingUsers(true);
      try {
        const users = await getAllUsersBasic();
        setInternalUsers(users);
      } catch (error) {
        console.error("Error fetching MSP users:", error);
      } finally {
        setIsLoadingUsers(false);
      }
    };
    fetchAllUsers();
  }, [internalUsers.length]);

  // Separate useEffect for ticket form options
  useEffect(() => {
    const fetchTicketFormOptions = async () => {
      if (!currentUser) return;
      try {
        const options = await getTicketFormOptions(currentUser as any);
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

    fetchTicketFormOptions();
  }, [currentUser?.user_id]);

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

  const handleFieldChange = async (field: string, value: string | boolean) => {
    // Check if client is being deactivated (is_inactive changing from false to true)
    if (field === 'is_inactive' && editedClient.is_inactive === false && value === true) {
      // Fetch active contacts for this client
      const { getContactsByClient } = await import('server/src/lib/actions/contact-actions/contactActions');
      const activeContacts = await getContactsByClient(editedClient.client_id, 'active');

      if (activeContacts.length > 0) {
        setActiveContactsToDeactivate(activeContacts);
        setIsDeactivateDialogOpen(true);
        return; // Don't update the field yet, wait for user confirmation
      }
    }

    // Check if client is being reactivated (is_inactive changing from true to false)
    if (field === 'is_inactive' && editedClient.is_inactive === true && value === false) {
      // Fetch inactive contacts for this client
      const { getContactsByClient } = await import('server/src/lib/actions/contact-actions/contactActions');
      const inactiveContacts = await getContactsByClient(editedClient.client_id, 'inactive');

      if (inactiveContacts.length > 0) {
        setInactiveContactsToReactivate(inactiveContacts);
        setIsReactivateDialogOpen(true);
        return; // Don't update the field yet, wait for user confirmation
      }
    }

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

  const handleTabChange = useCallback(async (tabValue: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', tabValue);
    memoizedRouter.push(`${pathname}?${params.toString()}`);
  }, [pathname, memoizedRouter, searchParams]);

  const tabContent = useMemo(() => [
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
            <div className="space-y-4">
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
                  key={locationsRefreshKey}
                  clientId={editedClient.client_id}
                  isEditing={false}
                />
              </div>
              <ClientSurveySummaryCard summary={surveySummary} />
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
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <BillingConfiguration
            client={editedClient}
            onSave={handleBillingConfigSave}
            contacts={contacts}
          />
        </div>
      )
    },
    {
      label: "Billing Dashboard",
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <ClientContractLineDashboard clientId={client.client_id} />
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
                memoizedRouter.refresh();
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
      content: (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <TaxSettingsForm clientId={client.client_id} />
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
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <ClientNotesPanel
            clientId={editedClient.client_id}
            legacyNotes={editedClient.notes}
          />
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
  ], [
    editedClient, 
    internalUsers, 
    isLoadingUsers, 
    t, 
    id, 
    tags, 
    handleTagsChange, 
    isInDrawer, 
    locationsRefreshKey, 
    surveySummary, 
    hasAttemptedSubmit, 
    fieldErrors, 
    handleSave, 
    isSaving, 
    setIsQuickAddTicketOpen, 
    ticketFormOptions, 
    client.client_id, 
    client.client_name, 
    handleBillingConfigSave, 
    contacts, 
    currentUser, 
    documents, 
    memoizedRouter,
    interactions
  ]);

  // Find the matching tab label case-insensitively
  const findTabLabel = useCallback((urlTab: string | null | undefined): string => {
    if (!urlTab) return 'Details';
    
    const matchingTab = tabContent.find(
      tab => tab.label.toLowerCase() === urlTab.toLowerCase()
    );
    return matchingTab?.label || 'Details';
  }, [tabContent]);

  return (
    <ReflectionContainer id={id} label="Client Details">
      <div className="flex items-center space-x-5 mb-4 pt-2">
        {!quickView && (
          <BackNav href="/msp/clients">
            {isInDrawer ? 'Back' : '← Back to Clients'}
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

          <div className="flex items-center gap-2 mr-8">
            <Button
              id={`${id}-delete-client-button`}
              onClick={handleDeleteClient}
              variant="destructive"
              size="sm"
              className="flex items-center"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
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
          onClose={() => {
            setIsLocationsDialogOpen(false);
            setLocationsRefreshKey(prev => prev + 1);
          }}
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
          onConfirm={editedClient.is_inactive && showDeactivateOption ? resetDeleteState : showDeactivateOption ? handleMarkClientInactiveAll : confirmDelete}
          title="Delete Client"
          message={
            editedClient.is_inactive && showDeactivateOption && deleteDependencies ? (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
                  <p className="text-amber-800">
                    <span className="font-semibold">Note:</span> This client is already marked as inactive.
                  </p>
                </div>
                <p className="text-gray-700">Unable to delete this client due to the following associated records:</p>
                <ul className="list-disc list-inside space-y-1 text-gray-700">
                  {deleteDependencies.contacts && deleteDependencies.contacts > 0 && (
                    <li>{deleteDependencies.contacts} contact{deleteDependencies.contacts !== 1 ? 's' : ''}</li>
                  )}
                  {deleteDependencies.tickets && deleteDependencies.tickets > 0 && (
                    <li>{deleteDependencies.tickets} ticket{deleteDependencies.tickets !== 1 ? 's' : ''}</li>
                  )}
                  {deleteDependencies.projects && deleteDependencies.projects > 0 && (
                    <li>{deleteDependencies.projects} project{deleteDependencies.projects !== 1 ? 's' : ''}</li>
                  )}
                  {deleteDependencies.invoices && deleteDependencies.invoices > 0 && (
                    <li>{deleteDependencies.invoices} invoice{deleteDependencies.invoices !== 1 ? 's' : ''}</li>
                  )}
                  {deleteDependencies.documents && deleteDependencies.documents > 0 && (
                    <li>{deleteDependencies.documents} document{deleteDependencies.documents !== 1 ? 's' : ''}</li>
                  )}
                  {deleteDependencies.interactions && deleteDependencies.interactions > 0 && (
                    <li>{deleteDependencies.interactions} interaction{deleteDependencies.interactions !== 1 ? 's' : ''}</li>
                  )}
                  {deleteDependencies.assets && deleteDependencies.assets > 0 && (
                    <li>{deleteDependencies.assets} asset{deleteDependencies.assets !== 1 ? 's' : ''}</li>
                  )}
                  {deleteDependencies.service_usage && deleteDependencies.service_usage > 0 && (
                    <li>{deleteDependencies.service_usage} service usage record{deleteDependencies.service_usage !== 1 ? 's' : ''}</li>
                  )}
                  {deleteDependencies.bucket_usage && deleteDependencies.bucket_usage > 0 && (
                    <li>{deleteDependencies.bucket_usage} bucket usage record{deleteDependencies.bucket_usage !== 1 ? 's' : ''}</li>
                  )}
                </ul>
                <p className="text-gray-700">Please remove or reassign these items before deleting the client.</p>
              </div>
            ) : showDeactivateOption && deleteDependencies ? (
              <div className="space-y-4">
                <p className="text-gray-700">Unable to delete this client.</p>
                <div>
                  <p className="text-gray-700 mb-2">This client has the following associated records:</p>
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    {deleteDependencies.contacts && deleteDependencies.contacts > 0 && (
                      <li>{deleteDependencies.contacts} contact{deleteDependencies.contacts !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.tickets && deleteDependencies.tickets > 0 && (
                      <li>{deleteDependencies.tickets} ticket{deleteDependencies.tickets !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.projects && deleteDependencies.projects > 0 && (
                      <li>{deleteDependencies.projects} project{deleteDependencies.projects !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.invoices && deleteDependencies.invoices > 0 && (
                      <li>{deleteDependencies.invoices} invoice{deleteDependencies.invoices !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.documents && deleteDependencies.documents > 0 && (
                      <li>{deleteDependencies.documents} document{deleteDependencies.documents !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.interactions && deleteDependencies.interactions > 0 && (
                      <li>{deleteDependencies.interactions} interaction{deleteDependencies.interactions !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.assets && deleteDependencies.assets > 0 && (
                      <li>{deleteDependencies.assets} asset{deleteDependencies.assets !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.service_usage && deleteDependencies.service_usage > 0 && (
                      <li>{deleteDependencies.service_usage} service usage record{deleteDependencies.service_usage !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.bucket_usage && deleteDependencies.bucket_usage > 0 && (
                      <li>{deleteDependencies.bucket_usage} bucket usage record{deleteDependencies.bucket_usage !== 1 ? 's' : ''}</li>
                    )}
                  </ul>
                </div>
                <Alert variant="info">
                  <AlertDescription>
                    <strong>Alternative Option:</strong> You can mark this client as inactive instead. Inactive clients are hidden from most views but retain all their data and can be marked as active later.
                    {deleteDependencies.contacts && deleteDependencies.contacts > 0 && (
                      <p className="mt-2">
                        Would you like to also deactivate the {deleteDependencies.contacts} associated contact{deleteDependencies.contacts !== 1 ? 's' : ''}?
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              </div>
            ) : deleteError ? (
              deleteError
            ) : (
              "Are you sure you want to delete this client? This action cannot be undone."
            )
          }
          confirmLabel={editedClient.is_inactive && showDeactivateOption ? "Close" : showDeactivateOption ? (deleteDependencies?.contacts && deleteDependencies.contacts > 0 ? "Client & Contacts" : "Mark as Inactive") : "Delete"}
          cancelLabel="Cancel"
          onCancel={showDeactivateOption && deleteDependencies?.contacts && deleteDependencies.contacts > 0 ? handleMarkClientInactiveOnly : undefined}
          thirdButtonLabel={showDeactivateOption && deleteDependencies?.contacts && deleteDependencies.contacts > 0 ? "Client Only" : undefined}
          isConfirming={false}
        />

        {/* Deactivate Confirmation Dialog */}
        <ConfirmationDialog
          id="deactivate-client-dialog"
          isOpen={isDeactivateDialogOpen}
          onClose={handleCancelDeactivation}
          onConfirm={() => handleDeactivateClient(true)}
          title="Deactivate Client"
          message={
            <div className="space-y-3">
              <p>
                This client has {activeContactsToDeactivate.length} active contact{activeContactsToDeactivate.length !== 1 ? 's' : ''}. Would you like to deactivate {activeContactsToDeactivate.length === 1 ? 'this contact' : 'all these contacts'} as well?
              </p>
              {activeContactsToDeactivate.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-gray-700 mb-2">Active contacts:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 max-h-40 overflow-y-auto">
                    {activeContactsToDeactivate.map((contact) => (
                      <li key={contact.contact_name_id}>
                        {contact.full_name}
                        {contact.email && ` (${contact.email})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm text-gray-500 mt-2">
                Deactivated users will not be able to log into the client portal.
              </p>
            </div>
          }
          confirmLabel="Client & Contacts"
          cancelLabel="Cancel"
          onCancel={() => handleDeactivateClient(false)}
          thirdButtonLabel="Client Only"
          isConfirming={false}
        />

        {/* Reactivate Confirmation Dialog */}
        <ConfirmationDialog
          id="reactivate-client-dialog"
          isOpen={isReactivateDialogOpen}
          onClose={handleCancelReactivation}
          onConfirm={() => handleReactivateClient(true)}
          title="Reactivate Client"
          message={
            <div className="space-y-3">
              <p>
                This client has {inactiveContactsToReactivate.length} inactive contact{inactiveContactsToReactivate.length !== 1 ? 's' : ''}. Would you like to reactivate {inactiveContactsToReactivate.length === 1 ? 'this contact' : 'all these contacts'} as well?
              </p>
              {inactiveContactsToReactivate.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-gray-700 mb-2">Inactive contacts:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 max-h-40 overflow-y-auto">
                    {inactiveContactsToReactivate.map((contact) => (
                      <li key={contact.contact_name_id}>
                        {contact.full_name}
                        {contact.email && ` (${contact.email})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          }
          confirmLabel="Client & Contacts"
          cancelLabel="Cancel"
          onCancel={() => handleReactivateClient(false)}
          thirdButtonLabel="Client Only"
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
