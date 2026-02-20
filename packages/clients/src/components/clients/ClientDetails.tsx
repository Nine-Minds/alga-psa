'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import type { DeletionValidationResult, IDocument } from '@alga-psa/types';
import { IContact } from '@alga-psa/types';
import type { IClient } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';
import { TagManager } from '@alga-psa/tags/components';
import { findTagsByEntityId } from '@alga-psa/tags/actions';
import { useTags } from '@alga-psa/tags/context';
import { getAllUsersBasicAsync, getCurrentUserAsync } from '../../lib/usersHelpers';
import { BillingCycleType } from '@alga-psa/types';
import Documents from '@alga-psa/documents/components/Documents';
import { validateCompanySize, validateAnnualRevenue, validateWebsiteUrl, validateIndustry, validateClientName } from '@alga-psa/validation';
import ClientContactsList from '../contacts/ClientContactsList';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { Switch } from '@alga-psa/ui/components/Switch';
import BillingConfiguration from './BillingConfiguration';
import {
  updateClient,
  uploadClientLogo,
  deleteClientLogo,
  getClientById,
  deleteClient,
  validateClientDeletion,
  reactivateClientContacts,
  deactivateClientContacts,
  markClientInactiveWithContacts,
  markClientActiveWithContacts,
  listClientInboundEmailDomains,
  addClientInboundEmailDomain,
  removeClientInboundEmailDomain,
} from '@alga-psa/clients/actions';
import { startEntraSync } from '@alga-psa/integrations/actions';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DeleteEntityDialog } from '@alga-psa/ui';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { QuickAddTicket } from '@alga-psa/tickets/components/QuickAddTicket';
import { Button } from '@alga-psa/ui/components/Button';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import BackNav from '@alga-psa/ui/components/BackNav';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from '@alga-psa/types';
import { useDrawer } from "@alga-psa/ui";
import TimezonePicker from '@alga-psa/ui/components/TimezonePicker';
import { IUser } from '@shared/interfaces/user.interfaces';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import ClientAssets from './ClientAssets';
import ClientTickets from './ClientTickets';
import ClientLocations from './ClientLocations';
import TaxSettingsForm from './TaxSettingsForm';
import { IBoard, ITicket, ITicketCategory } from '@alga-psa/types';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';
import { getImageUrl } from '@alga-psa/documents/actions/documentActions';
import ClientContractLineDashboard from './ClientContractLineDashboard';
import { ClientNotesPanel } from './panels/ClientNotesPanel';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui';
import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { getTicketFormOptions } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ClientLanguagePreference } from './ClientLanguagePreference';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import ClientSurveySummaryCard from '@alga-psa/surveys/components/ClientSurveySummaryCard';
import type { SurveyClientSatisfactionSummary } from '@alga-psa/types';
import { shouldShowEntraSyncAction } from './clientDetailsEntraSyncAction';


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
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [isReactivateDialogOpen, setIsReactivateDialogOpen] = useState(false);
  const [inactiveContactsToReactivate, setInactiveContactsToReactivate] = useState<IContact[]>([]);
  const [isDeactivateDialogOpen, setIsDeactivateDialogOpen] = useState(false);
  const [activeContactsToDeactivate, setActiveContactsToDeactivate] = useState<IContact[]>([]);
  const [isEditingLogo, setIsEditingLogo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingEntra, setIsSyncingEntra] = useState(false);
  const [entraSyncRunId, setEntraSyncRunId] = useState<string | null>(null);
  const [entraSyncStatus, setEntraSyncStatus] = useState<string | null>(null);
  const [ticketFormOptions, setTicketFormOptions] = useState<{
    statusOptions: SelectOption[];
    priorityOptions: SelectOption[];
    boardOptions: IBoard[];
    categories: ITicketCategory[];
    tags?: ITag[];
    users?: IUser[];
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
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  const entraClientSyncFlag = useFeatureFlag('entra-integration-client-sync-action', {
    defaultValue: false,
  });
  const showEntraSyncAction = shouldShowEntraSyncAction(
    isEEAvailable ? 'enterprise' : process.env.NEXT_PUBLIC_EDITION,
    entraClientSyncFlag.enabled
  );

  const fetchEntraSyncRunStatus = useCallback(async (runId: string): Promise<string | null> => {
    const response = await fetch(`/api/integrations/entra/sync/runs/${runId}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: { run?: { status?: string } | null };
      error?: string;
    } | null;

    if (!response.ok || !payload?.success) {
      return null;
    }

    const status = payload.data?.run?.status ? String(payload.data.run.status) : null;
    return status;
  }, []);

  useEffect(() => {
    if (!entraSyncRunId) {
      return;
    }

    let cancelled = false;
    const terminalStatuses = new Set(['completed', 'failed', 'partial']);

    const poll = async () => {
      try {
        const nextStatus = await fetchEntraSyncRunStatus(entraSyncRunId);
        if (!nextStatus || cancelled) {
          return;
        }

        setEntraSyncStatus(`Run ${entraSyncRunId}: ${nextStatus}`);
        if (terminalStatuses.has(nextStatus.toLowerCase())) {
          setEntraSyncRunId(null);
        }
      } catch {
        // Keep polling resilient and avoid noisy UI errors on transient failures.
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [entraSyncRunId, fetchEntraSyncRunStatus]);


  const runDeleteValidation = useCallback(async () => {
    setIsDeleteValidating(true);
    try {
      const result = await validateClientDeletion(editedClient.client_id);
      setDeleteValidation(result);
    } catch (error: any) {
      console.error('Failed to validate client deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: 'Failed to validate deletion. Please try again.',
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [editedClient.client_id]);

  const handleDeleteClient = () => {
    setIsDeleteDialogOpen(true);
    void runDeleteValidation();
  };

  const confirmDelete = async () => {
    setIsDeleteProcessing(true);
    try {
      const result = await deleteClient(editedClient.client_id);

      if (!result.success) {
        setDeleteValidation(result);
        return;
      }

      resetDeleteState();
      toast.success("Client has been deleted successfully.");

      if (isInDrawer) {
        drawer.closeDrawer();
      } else {
        router.push('/msp/clients');
      }
    } catch (error: any) {
      console.error('Failed to delete client:', error);
      toast.error(error.message || 'Failed to delete client. Please try again.');
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const handleDeleteAlternativeAction = async (action: string) => {
    if (action !== 'deactivate') {
      return;
    }

    setIsDeleteProcessing(true);
    try {
      await handleMarkClientInactiveAll();
    } finally {
      setIsDeleteProcessing(false);
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
      const { getContactsByClient } = await import('@alga-psa/clients/actions');
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
      const { getContactsByClient } = await import('@alga-psa/clients/actions');
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
    setDeleteValidation(null);
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
        const user = await getCurrentUserAsync();
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
        const users = await getAllUsersBasicAsync();
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
        const options = await getTicketFormOptions();
        setTicketFormOptions({
          statusOptions: options.statusOptions,
          priorityOptions: options.priorityOptions,
          boardOptions: options.boardOptions,
          categories: options.categories,
          tags: options.tags,
          users: options.users
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
      const { getContactsByClient } = await import('@alga-psa/clients/actions');
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
      const { getContactsByClient } = await import('@alga-psa/clients/actions');
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

  const handleSyncEntraNow = async () => {
    if (isSyncingEntra) return;

    setIsSyncingEntra(true);
    try {
      const result = await startEntraSync({
        scope: 'single-client',
        clientId: editedClient.client_id,
      });

      if ('error' in result) {
        toast.error(result.error || 'Failed to start Entra sync.');
        return;
      }

      if (!result.success) {
        toast.error('Failed to start Entra sync.');
        return;
      }

      const runId = result.data?.runId;
      if (runId) {
        setEntraSyncRunId(runId);
        setEntraSyncStatus(`Run ${runId}: queued`);
        toast.success(`Entra sync started. Run ID: ${runId}`);
      } else {
        setEntraSyncStatus('Entra sync started for this client.');
        toast.success('Entra sync started for this client.');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start Entra sync.';
      toast.error(message);
    } finally {
      setIsSyncingEntra(false);
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

  const clientActiveContacts = useMemo(() => {
    return (contacts ?? []).filter((c) => !c?.is_inactive);
  }, [contacts]);

  const handleDefaultContactChange = useCallback((contactId: string) => {
    const selected = contactId ? clientActiveContacts.find((c) => c.contact_name_id === contactId) : undefined;
    const selectedName = contactId ? (selected?.full_name ?? '') : '';

    setEditedClient((prevClient) => {
      const updatedClient = JSON.parse(JSON.stringify(prevClient)) as IClient;
      if (!updatedClient.properties) {
        updatedClient.properties = {};
      }
      (updatedClient.properties as any).primary_contact_id = contactId;
      (updatedClient.properties as any).primary_contact_name = selectedName;
      return updatedClient;
    });

    setHasUnsavedChanges(() => {
      const tempClient = JSON.parse(JSON.stringify(editedClient)) as IClient;
      if (!tempClient.properties) {
        tempClient.properties = {};
      }
      (tempClient.properties as any).primary_contact_id = contactId;
      (tempClient.properties as any).primary_contact_name = selectedName;
      return JSON.stringify(tempClient) !== JSON.stringify(client);
    });
  }, [clientActiveContacts, editedClient, client]);

  const [inboundEmailDomains, setInboundEmailDomains] = useState<Array<{ id: string; domain: string }>>([]);
  const [inboundDomainDraft, setInboundDomainDraft] = useState('');
  const [isInboundDomainBusy, setIsInboundDomainBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listClientInboundEmailDomains(editedClient.client_id);
        if (cancelled) return;
        setInboundEmailDomains((rows ?? []).map((r: any) => ({ id: r.id, domain: r.domain })));
      } catch (error) {
        // Non-blocking; if this fails we don't want to prevent other client edits.
        console.error('Failed to load inbound email domains:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editedClient.client_id]);

  const normalizeInboundDomain = useCallback((raw: string) => {
    const trimmed = (raw ?? '').trim().toLowerCase();
    return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  }, []);

  const handleAddInboundDomain = useCallback(async () => {
    const domain = normalizeInboundDomain(inboundDomainDraft);
    if (!domain) return;
    setIsInboundDomainBusy(true);
    try {
      const created = await addClientInboundEmailDomain(editedClient.client_id, domain);
      setInboundEmailDomains((prev) => {
        const next = [...prev, { id: (created as any).id, domain: (created as any).domain }].filter(
          (d, idx, arr) => idx === arr.findIndex((x) => x.id === d.id)
        );
        next.sort((a, b) => a.domain.localeCompare(b.domain));
        return next;
      });
      setInboundDomainDraft('');
      toast.success('Inbound email domain added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add domain');
    } finally {
      setIsInboundDomainBusy(false);
    }
  }, [addClientInboundEmailDomain, editedClient.client_id, inboundDomainDraft, normalizeInboundDomain]);

  const handleRemoveInboundDomain = useCallback(async (domainId: string) => {
    if (!domainId) return;
    setIsInboundDomainBusy(true);
    try {
      await removeClientInboundEmailDomain(editedClient.client_id, domainId);
      setInboundEmailDomains((prev) => prev.filter((d) => d.id !== domainId));
      toast.success('Inbound email domain removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove domain');
    } finally {
      setIsInboundDomainBusy(false);
    }
  }, [editedClient.client_id]);

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
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  disabled={isLoadingUsers}
                  placeholder={isLoadingUsers ? "Loading users..." : "Select Account Manager"}
                  buttonWidth="full"
                />
              </FieldContainer>

              <FieldContainer
                label="Default contact"
                fieldType="select"
                value={editedClient.properties?.primary_contact_id || ''}
                helperText="Used when inbound email sender is not a known contact but matches this client by configured inbound email domain."
                automationId="default-contact-field"
              >
                <Text as="label" size="2" className="text-gray-700 font-medium">Default contact</Text>
                <ContactPicker
                  id="client-default-contact-select"
                  contacts={clientActiveContacts}
                  value={editedClient.properties?.primary_contact_id || ''}
                  onValueChange={handleDefaultContactChange}
                  clientId={editedClient.client_id}
                  label="Default contact"
                  placeholder={clientActiveContacts.length ? "Select default contact" : "No active contacts"}
                />
              </FieldContainer>

              <FieldContainer
                label="Inbound email domains"
                fieldType="textField"
                value={inboundEmailDomains.map((d) => d.domain).join(', ')}
                helperText="Only these domains will be used for inbound email domain matching (e.g. acme.com). Domains must be unique across clients."
                automationId="client-inbound-email-domains-field"
              >
                <Text as="label" size="2" className="text-gray-700 font-medium">Inbound email domains</Text>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      id="client-inbound-email-domain-input"
                      type="text"
                      value={inboundDomainDraft}
                      onChange={(e) => setInboundDomainDraft(e.target.value)}
                      placeholder="acme.com"
                      className="flex-1"
                    />
                    <Button
                      id="client-inbound-email-domain-add"
                      type="button"
                      variant="default"
                      disabled={isInboundDomainBusy || !normalizeInboundDomain(inboundDomainDraft)}
                      onClick={handleAddInboundDomain}
                    >
                      Add
                    </Button>
                  </div>

                  {inboundEmailDomains.length > 0 ? (
                    <div className="space-y-2">
                      {inboundEmailDomains.map((d) => (
                        <div key={d.id} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
                          <Text size="2" className="text-gray-800">{d.domain}</Text>
                          <Button
                            id={`client-inbound-email-domain-remove-${d.id}`}
                            type="button"
                            variant="ghost"
                            disabled={isInboundDomainBusy}
                            onClick={() => handleRemoveInboundDomain(d.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Text size="1" className="text-gray-500">
                      No inbound email domains configured. Domain matching will not be used.
                    </Text>
                  )}
                </div>
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
              initialUsers={ticketFormOptions.users || []}
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
      label: "Assets",
      content: (
        <ClientAssets clientId={client.client_id} />
      )
    },
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
          <Suspense fallback={<div>Loading tax settings...</div>}>
            <TaxSettingsForm clientId={client.client_id} />
          </Suspense>
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
    handleDefaultContactChange,
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
            {showEntraSyncAction && (
              <div className="flex flex-col items-end gap-1">
                <Button
                  id={`${id}-sync-entra-now-button`}
                  onClick={handleSyncEntraNow}
                  variant="outline"
                  size="sm"
                  className="flex items-center"
                  disabled={isSyncingEntra}
                >
                  {isSyncingEntra ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Sync Entra Now
                </Button>
                {entraSyncStatus ? (
                  <p className="text-xs text-muted-foreground" id={`${id}-sync-entra-status`}>
                    {entraSyncStatus}
                  </p>
                ) : null}
              </div>
            )}
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
        <DeleteEntityDialog
          id="delete-client-dialog"
          isOpen={isDeleteDialogOpen}
          onClose={resetDeleteState}
          onConfirmDelete={confirmDelete}
          onAlternativeAction={handleDeleteAlternativeAction}
          entityName={editedClient.client_name}
          validationResult={deleteValidation}
          isValidating={isDeleteValidating}
          isDeleting={isDeleteProcessing}
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
