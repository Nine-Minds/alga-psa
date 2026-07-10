'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeletionValidationResult, IClient, IClientWithLocation, IContact, ISlaPolicy, ITag } from '@alga-psa/types';
import { findTagsByEntityId } from '@alga-psa/tags/actions/tagActions';
import { isTagActionError } from '@alga-psa/tags/actions/tagActionErrors';
import { getAllUsersBasicAsync } from '../../lib/usersHelpers';
import { IUser } from '@shared/interfaces/user.interfaces';
import {
  deleteClient,
  deleteClientLogo,
  markClientActiveWithContacts,
  markClientInactiveWithContacts,
  updateClient,
  uploadClientLogo,
  validateClientDeletion,
} from '@alga-psa/clients/actions/clientActions';
import { getContactsByClient, getClientById } from '@alga-psa/clients/actions/queryActions';
import {
  addClientInboundEmailDomain,
  listClientInboundEmailDomains,
  removeClientInboundEmailDomain,
} from '@alga-psa/clients/actions/clientInboundEmailDomainActions';
import {
  addClientNameAlias,
  listClientNameAliases,
  removeClientNameAlias,
} from '@alga-psa/clients/actions/clientNameAliasActions';
import { listInboundTicketDestinationOptions } from '@alga-psa/clients/actions/inboundTicketDestinationActions';
import { startClientEntraSync } from '@alga-psa/clients/actions/entraClientSyncActions';
import { useClientCrossFeature } from '../../context/ClientCrossFeatureContext';
import { handleError, useDrawer, DeleteEntityDialog } from '@alga-psa/ui';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { PrintButton } from '@alga-psa/ui/components/PrintButton';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import Spinner from '@alga-psa/ui/components/Spinner';
import { usePageSaveShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useRouter } from 'next/navigation';
import { Heading } from '@radix-ui/themes';
import { AlertCircle, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import ClientLocations from './ClientLocations';
import {
  formatEntraRunStatusLabel,
  isTerminalEntraRunStatus,
  resolveEntraClientSyncStartState,
  shouldShowEntraSyncAction,
} from './clientDetailsEntraSyncAction';
import { ClientDetailsTabContent } from './ClientDetailsTabContent';

function isClientActionError(value: unknown): value is ActionMessageError | ActionPermissionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

interface ClientQuickViewProps {
  clientId?: string;
  client?: IClient;
  id?: string;
  isInDrawer?: boolean;
  quickView?: boolean;
  onClose?: () => void;
}

export const ClientQuickView: React.FC<ClientQuickViewProps> = ({
  clientId,
  client: initialClient,
  id = 'client-quick-view',
  isInDrawer = true,
  onClose,
}) => {
  const { t } = useTranslation('msp/clients');
  const router = useRouter();
  const drawer = useDrawer();
  const { renderQuickAddTicket, renderSurveySummaryCard, getSlaPolicies } = useClientCrossFeature();
  const resolvedClientId = clientId ?? initialClient?.client_id;
  const [client, setClient] = useState<IClientWithLocation | IClient | null>(initialClient ?? null);
  const [editedClient, setEditedClient] = useState<IClient | null>(initialClient ?? null);
  const [loading, setLoading] = useState(!initialClient);
  const [error, setError] = useState<string | null>(null);
  const [internalUsers, setInternalUsers] = useState<IUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [defaultContactOptions, setDefaultContactOptions] = useState<IContact[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [slaPolicies, setSlaPolicies] = useState<ISlaPolicy[]>([]);
  const [isLoadingSlaPolicies, setIsLoadingSlaPolicies] = useState(false);
  const [tags, setTags] = useState<ITag[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState(false);
  const [isLocationsDialogOpen, setIsLocationsDialogOpen] = useState(false);
  const [locationsRefreshKey, setLocationsRefreshKey] = useState(0);
  const [inboundEmailDomains, setInboundEmailDomains] = useState<Array<{ id: string; domain: string }>>([]);
  const [inboundDomainDraft, setInboundDomainDraft] = useState('');
  const [isInboundDomainBusy, setIsInboundDomainBusy] = useState(false);
  const [inboundDestinationOptions, setInboundDestinationOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [isInboundDestinationOptionsLoading, setIsInboundDestinationOptionsLoading] = useState(false);
  const [clientNameAliases, setClientNameAliases] = useState<Array<{ id: string; alias: string }>>([]);
  const [aliasDraft, setAliasDraft] = useState('');
  const [isAliasBusy, setIsAliasBusy] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [isDeactivateDialogOpen, setIsDeactivateDialogOpen] = useState(false);
  const [isReactivateDialogOpen, setIsReactivateDialogOpen] = useState(false);
  const [activeContactsToDeactivate, setActiveContactsToDeactivate] = useState<IContact[]>([]);
  const [inactiveContactsToReactivate, setInactiveContactsToReactivate] = useState<IContact[]>([]);
  const [isSyncingEntra, setIsSyncingEntra] = useState(false);
  const [entraSyncRunId, setEntraSyncRunId] = useState<string | null>(null);
  const [entraSyncStatus, setEntraSyncStatus] = useState<string | null>(null);
  const entraClientSyncFlag = useFeatureFlag('entra-integration-client-sync-action', {
    defaultValue: false,
  });
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  const showEntraSyncAction = shouldShowEntraSyncAction(
    isEEAvailable ? 'enterprise' : process.env.NEXT_PUBLIC_EDITION,
    entraClientSyncFlag.enabled,
    editedClient
  );

  useEffect(() => {
    if (initialClient) {
      setClient(initialClient);
      setEditedClient(initialClient);
      setLoading(false);
    }
  }, [initialClient]);

  useEffect(() => {
    if (!resolvedClientId || initialClient) return;

    let cancelled = false;
    const fetchClient = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getClientById(resolvedClientId);
        if (cancelled) return;
        if (!data) {
          setError(t('clientQuickView.notFound', { defaultValue: 'Client not found' }));
        } else {
          setClient(data);
          setEditedClient({
            ...data,
            client_type: data.client_type || 'company',
          });
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Error fetching client for quick view:', err);
        setError(t('clientQuickView.loadError', { defaultValue: 'Failed to load client details' }));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchClient();
    return () => {
      cancelled = true;
    };
  }, [resolvedClientId, initialClient, t]);

  useEffect(() => {
    const fetchAllUsers = async () => {
      if (internalUsers.length > 0) return;
      setIsLoadingUsers(true);
      try {
        const users = await getAllUsersBasicAsync();
        setInternalUsers(users);
      } catch (err) {
        console.error('Error fetching MSP users:', err);
      } finally {
        setIsLoadingUsers(false);
      }
    };
    void fetchAllUsers();
  }, [internalUsers.length]);

  useEffect(() => {
    if (!editedClient?.client_id) return;
    let cancelled = false;
    (async () => {
      try {
        const clientTags = await findTagsByEntityId(editedClient.client_id, 'client');
        if (isTagActionError(clientTags)) {
          console.error('Error fetching tags:', clientTags);
          return;
        }
        if (!cancelled) {
          setTags(clientTags);
        }
      } catch (err) {
        console.error('Error fetching tags:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editedClient?.client_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (slaPolicies.length > 0) return;
      setIsLoadingSlaPolicies(true);
      try {
        const policies = await getSlaPolicies();
        if (!cancelled) {
          setSlaPolicies(policies);
        }
      } catch (err) {
        console.error('Error fetching SLA policies:', err);
      } finally {
        if (!cancelled) {
          setIsLoadingSlaPolicies(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getSlaPolicies, slaPolicies.length]);

  useEffect(() => {
    if (!editedClient?.client_id) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listClientInboundEmailDomains(editedClient.client_id);
        if (!cancelled) {
          if (isClientActionError(rows)) {
            toast.error(getErrorMessage(rows));
            return;
          }
          setInboundEmailDomains((rows ?? []).map((r: any) => ({ id: r.id, domain: r.domain })));
        }
      } catch (err) {
        console.error('Failed to load inbound email domains:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editedClient?.client_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsInboundDestinationOptionsLoading(true);
      try {
        const rows = await listInboundTicketDestinationOptions();
        if (cancelled) return;
        if (isClientActionError(rows)) {
          toast.error(getErrorMessage(rows));
          setInboundDestinationOptions([]);
          return;
        }
        setInboundDestinationOptions((rows ?? []).map((row: any) => ({
          value: row.id,
          label: row.is_active
            ? `${row.display_name} (${row.short_name})`
            : `${row.display_name} (${row.short_name}) [inactive]`,
        })));
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load inbound ticket destination options:', err);
          setInboundDestinationOptions([]);
        }
      } finally {
        if (!cancelled) {
          setIsInboundDestinationOptionsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!editedClient?.client_id) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listClientNameAliases(editedClient.client_id);
        if (!cancelled) {
          if (isClientActionError(rows)) {
            toast.error(getErrorMessage(rows));
            return;
          }
          setClientNameAliases((rows ?? []).map((r: any) => ({ id: r.id, alias: r.alias })));
        }
      } catch (err) {
        console.error('Failed to load client name aliases:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editedClient?.client_id]);

  const clientActiveContacts = useMemo(() => {
    return (defaultContactOptions ?? []).filter((contact) => !contact?.is_inactive);
  }, [defaultContactOptions]);

  const updateUnsavedState = useCallback((nextClient: IClient) => {
    setHasUnsavedChanges(JSON.stringify(nextClient) !== JSON.stringify(client));
  }, [client]);

  const setClientInactiveState = useCallback((isInactive: boolean) => {
    setClient((prev) => prev ? { ...prev, is_inactive: isInactive } : prev);
    setEditedClient((prev) => prev ? { ...prev, is_inactive: isInactive } : prev);
    setHasUnsavedChanges(false);
  }, []);

  const refreshClientData = useCallback(async () => {
    if (!client?.client_id) return;

    try {
      const latestClientData = await getClientById(client.client_id);
      if (latestClientData) {
        setClient(latestClientData);
        setEditedClient(latestClientData);
        setHasUnsavedChanges(false);
      }
    } catch (err) {
      console.error('Error refreshing client data:', err);
    }
  }, [client?.client_id]);

  const fetchEntraSyncRunStatus = useCallback(async (runId: string): Promise<string | null> => {
    const response = await fetch(`/api/integrations/entra/sync/runs/${encodeURIComponent(runId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as { status?: string | null };
    return payload.status ?? null;
  }, []);

  useEffect(() => {
    if (!entraSyncRunId) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const nextStatus = await fetchEntraSyncRunStatus(entraSyncRunId);
        if (cancelled || !nextStatus) return;
        setEntraSyncStatus(formatEntraRunStatusLabel(nextStatus));
        if (isTerminalEntraRunStatus(nextStatus)) {
          setEntraSyncRunId(null);
          await refreshClientData();
          return;
        }
      } catch {
        if (!cancelled) {
          setEntraSyncStatus(t('clientDetails.entraSyncStatusUnknown', { defaultValue: 'Sync status unavailable' }));
        }
      }

      if (!cancelled) {
        timeoutId = setTimeout(poll, 5000);
      }
    };

    timeoutId = setTimeout(poll, 3000);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [entraSyncRunId, fetchEntraSyncRunStatus, refreshClientData, t]);

  const handleDeactivateClient = useCallback(async (deactivateContacts: boolean) => {
    if (!editedClient?.client_id) return;
    try {
      const result = await markClientInactiveWithContacts(editedClient.client_id, deactivateContacts);
      if (!result.success) {
        handleError(new Error(result.message || 'Failed to deactivate client'));
        setIsDeactivateDialogOpen(false);
        return;
      }

      setClientInactiveState(true);
      toast.success(deactivateContacts && result.contactsDeactivated > 0
        ? t('clientDetails.deactivateWithContactsSuccess', {
            defaultValue: 'Client and {{count}} contacts have been deactivated successfully.',
            count: result.contactsDeactivated,
          })
        : t('clientDetails.inactiveSuccess', {
            defaultValue: 'Client has been marked as inactive successfully.',
          }));
      setIsDeactivateDialogOpen(false);
      router.refresh();
    } catch (err) {
      handleError(err, 'An error occurred while deactivating the client. Please try again.');
    }
  }, [editedClient?.client_id, router, setClientInactiveState, t]);

  const handleReactivateClient = useCallback(async (reactivateContacts: boolean) => {
    if (!editedClient?.client_id) return;
    try {
      const result = await markClientActiveWithContacts(editedClient.client_id, reactivateContacts);
      if (!result.success) {
        handleError(new Error(result.message || 'Failed to reactivate client'));
        setIsReactivateDialogOpen(false);
        return;
      }

      setClientInactiveState(false);
      toast.success(reactivateContacts && result.contactsReactivated > 0
        ? t('clientDetails.reactivateWithContactsSuccess', {
            defaultValue: 'Client and {{count}} contacts have been reactivated successfully.',
            count: result.contactsReactivated,
          })
        : t('clientDetails.reactivateSuccess', {
            defaultValue: 'Client has been reactivated successfully.',
          }));
      setIsReactivateDialogOpen(false);
      router.refresh();
    } catch (err) {
      handleError(err, 'An error occurred while reactivating the client. Please try again.');
    }
  }, [editedClient?.client_id, router, setClientInactiveState, t]);

  const handleDirectMarkInactive = useCallback(async () => {
    if (!editedClient?.client_id) return;
    try {
      const activeContacts = await getContactsByClient(editedClient.client_id, 'active');
      if (activeContacts.length > 0) {
        setActiveContactsToDeactivate(activeContacts);
        setIsDeactivateDialogOpen(true);
        return;
      }

      await handleDeactivateClient(false);
    } catch (err) {
      handleError(err, 'An error occurred while marking the client as inactive. Please try again.');
    }
  }, [editedClient?.client_id, handleDeactivateClient]);

  const handleDirectReactivate = useCallback(async () => {
    if (!editedClient?.client_id) return;
    try {
      const inactiveContacts = await getContactsByClient(editedClient.client_id, 'inactive');
      if (inactiveContacts.length > 0) {
        setInactiveContactsToReactivate(inactiveContacts);
        setIsReactivateDialogOpen(true);
        return;
      }

      await handleReactivateClient(false);
    } catch (err) {
      handleError(err, 'An error occurred while reactivating the client. Please try again.');
    }
  }, [editedClient?.client_id, handleReactivateClient]);

  const handleFieldChange = useCallback((field: string, value: string | boolean | null) => {
    if (field === 'is_inactive') {
      void (value ? handleDirectMarkInactive() : handleDirectReactivate());
      return;
    }

    setEditedClient((prevClient) => {
      if (!prevClient) return prevClient;
      const updatedClient = JSON.parse(JSON.stringify(prevClient)) as IClient;

      if (field.startsWith('properties.') && field !== 'properties.account_manager_id') {
        const propertyField = field.split('.')[1];
        updatedClient.properties = updatedClient.properties || {};
        (updatedClient.properties as any)[propertyField] = value;
        if (propertyField === 'website' && typeof value === 'string') {
          updatedClient.url = value;
        }
      } else if (field === 'url') {
        updatedClient.url = value as string;
        updatedClient.properties = updatedClient.properties || {};
        (updatedClient.properties as any).website = value as string;
      } else {
        (updatedClient as any)[field] = value;
      }

      updateUnsavedState(updatedClient);
      return updatedClient;
    });
  }, [handleDirectMarkInactive, handleDirectReactivate, updateUnsavedState]);

  const handleDefaultContactChange = useCallback((contactId: string) => {
    const selected = contactId ? clientActiveContacts.find((contact) => contact.contact_name_id === contactId) : undefined;
    const selectedName = contactId ? (selected?.full_name ?? '') : '';

    setEditedClient((prevClient) => {
      if (!prevClient) return prevClient;
      const updatedClient = JSON.parse(JSON.stringify(prevClient)) as IClient;
      updatedClient.properties = updatedClient.properties || {};
      (updatedClient.properties as any).primary_contact_id = contactId;
      (updatedClient.properties as any).primary_contact_name = selectedName;
      updateUnsavedState(updatedClient);
      return updatedClient;
    });
  }, [clientActiveContacts, updateUnsavedState]);

  const editedClientRef = useRef(editedClient);
  editedClientRef.current = editedClient;
  const isSavingRef = useRef(isSaving);
  isSavingRef.current = isSaving;

  const handleSave = useCallback(async () => {
    if (isSavingRef.current || !client?.client_id || !editedClientRef.current) return;
    setHasAttemptedSubmit(true);

    const clientName = editedClientRef.current.client_name?.trim() || '';
    if (!clientName) {
      setFieldErrors({ client_name: t('clientDetails.clientNameRequired', { defaultValue: 'Client name is required' }) });
      return;
    }

    setFieldErrors({});
    setIsSaving(true);
    try {
      const { account_manager_full_name, ...restOfEditedClient } = editedClientRef.current;
      const dataToUpdate: Partial<Omit<IClient, 'account_manager_full_name'>> = {
        ...restOfEditedClient,
        properties: restOfEditedClient.properties ? { ...restOfEditedClient.properties } : {},
        account_manager_id: editedClientRef.current.account_manager_id === '' ? null : editedClientRef.current.account_manager_id,
      };
      const updateResult = await updateClient(client.client_id, dataToUpdate);
      if (isClientActionError(updateResult)) {
        handleError(updateResult);
        return;
      }

      const updatedClient = updateResult as IClient;
      setClient(updatedClient);
      setEditedClient(updatedClient);
      setHasUnsavedChanges(false);
      setHasAttemptedSubmit(false);
      toast.success(t('clientDetails.saveSuccess', { defaultValue: 'Client details saved successfully.' }));
    } catch (err) {
      console.error('Error saving client:', err);
      toast.error(t('clientDetails.saveError', { defaultValue: 'Failed to save client details. Please try again.' }));
    } finally {
      setIsSaving(false);
    }
  }, [client?.client_id, t]);

  usePageSaveShortcut(handleSave, { enabled: hasUnsavedChanges && !isSaving });

  const normalizeInboundDomain = useCallback((raw: string) => {
    const trimmed = (raw ?? '').trim().toLowerCase();
    return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  }, []);

  const handleAddInboundDomain = useCallback(async () => {
    if (!editedClient?.client_id) return;
    const domain = normalizeInboundDomain(inboundDomainDraft);
    if (!domain) return;
    setIsInboundDomainBusy(true);
    try {
      const created = await addClientInboundEmailDomain(editedClient.client_id, domain);
      if (isClientActionError(created)) {
        toast.error(getErrorMessage(created));
        return;
      }
      setInboundEmailDomains((prev) => [...prev, { id: (created as any).id, domain: (created as any).domain }]);
      setInboundDomainDraft('');
      toast.success(t('clientDetails.inboundDomainAdded'));
    } catch (err) {
      console.error('Failed to add inbound email domain:', err);
      toast.error(t('clientDetails.inboundDomainAddFailed'));
    } finally {
      setIsInboundDomainBusy(false);
    }
  }, [editedClient?.client_id, inboundDomainDraft, normalizeInboundDomain, t]);

  const handleRemoveInboundDomain = useCallback(async (domainId: string) => {
    if (!editedClient?.client_id || !domainId) return;
    setIsInboundDomainBusy(true);
    try {
      const result = await removeClientInboundEmailDomain(editedClient.client_id, domainId);
      if (isClientActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      setInboundEmailDomains((prev) => prev.filter((domain) => domain.id !== domainId));
      toast.success(t('clientDetails.inboundDomainRemoved'));
    } catch (err) {
      console.error('Failed to remove inbound email domain:', err);
      toast.error(t('clientDetails.inboundDomainRemoveFailed'));
    } finally {
      setIsInboundDomainBusy(false);
    }
  }, [editedClient?.client_id, t]);

  const handleAddClientNameAlias = useCallback(async () => {
    if (!editedClient?.client_id) return;
    const alias = aliasDraft.replace(/\s+/g, ' ').trim();
    if (!alias) return;
    setIsAliasBusy(true);
    try {
      const created = await addClientNameAlias(editedClient.client_id, alias);
      if (isClientActionError(created)) {
        toast.error(getErrorMessage(created));
        return;
      }
      setClientNameAliases((prev) => [...prev, { id: (created as any).id, alias: (created as any).alias }]);
      setAliasDraft('');
      toast.success(t('clientDetails.nameAliasAdded', { defaultValue: 'Alias added' }));
    } catch (err) {
      console.error('Failed to add client alias:', err);
      toast.error(t('clientDetails.nameAliasAddFailed', { defaultValue: 'Failed to add alias' }));
    } finally {
      setIsAliasBusy(false);
    }
  }, [aliasDraft, editedClient?.client_id, t]);

  const handleRemoveClientNameAlias = useCallback(async (aliasId: string) => {
    if (!editedClient?.client_id || !aliasId) return;
    setIsAliasBusy(true);
    try {
      const result = await removeClientNameAlias(editedClient.client_id, aliasId);
      if (isClientActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      setClientNameAliases((prev) => prev.filter((alias) => alias.id !== aliasId));
      toast.success(t('clientDetails.nameAliasRemoved', { defaultValue: 'Alias removed' }));
    } catch (err) {
      console.error('Failed to remove client alias:', err);
      toast.error(t('clientDetails.nameAliasRemoveFailed', { defaultValue: 'Failed to remove alias' }));
    } finally {
      setIsAliasBusy(false);
    }
  }, [editedClient?.client_id, t]);

  const localizeClientDeleteValidation = useCallback((result: DeletionValidationResult): DeletionValidationResult => {
    const hasClientOnlyAlternative = result.alternatives.some((alternative) => alternative.action === 'deactivate_client_only');
    const dependencyLabel = (type: string, count: number, fallback: string) => {
      const dependencyKeys: Record<string, [string, string, string, string]> = {
        contact: ['clientsPage.dependency.contact', 'contact', 'clientsPage.dependency.contacts', 'contacts'],
        ticket: ['clientsPage.dependency.ticket', 'ticket', 'clientsPage.dependency.tickets', 'tickets'],
        project: ['clientsPage.dependency.project', 'project', 'clientsPage.dependency.projects', 'projects'],
        invoice: ['clientsPage.dependency.invoice', 'invoice', 'clientsPage.dependency.invoices', 'invoices'],
        document: ['clientsPage.dependency.document', 'document', 'clientsPage.dependency.documents', 'documents'],
        interaction: ['clientsPage.dependency.interaction', 'interaction', 'clientsPage.dependency.interactions', 'interactions'],
        asset: ['clientsPage.dependency.asset', 'asset', 'clientsPage.dependency.assets', 'assets'],
        usage: ['clientsPage.dependency.serviceUsageRecord', 'service usage record', 'clientsPage.dependency.serviceUsageRecords', 'service usage records'],
        bucket_usage: ['clientsPage.dependency.bucketUsageRecord', 'bucket usage record', 'clientsPage.dependency.bucketUsageRecords', 'service usage records'],
      };
      const keys = dependencyKeys[type];
      if (!keys) return fallback;
      const [singularKey, singularDefault, pluralKey, pluralDefault] = keys;
      return count === 1
        ? t(singularKey, { defaultValue: singularDefault })
        : t(pluralKey, { defaultValue: pluralDefault });
    };

    const message = (() => {
      if (result.code === 'DEPENDENCIES_EXIST') {
        return t('clientsPage.deleteClientUnable', { defaultValue: 'Unable to delete this client.' });
      }
      if (result.code === 'IS_DEFAULT') {
        return t('clientsPage.defaultClientDeleteError', {
          defaultValue: 'Cannot delete the default client. Please set another client as default in General Settings first.',
        });
      }
      if (result.code === 'NOT_FOUND') {
        return t('clientsPage.clientNotFound', { defaultValue: 'Client not found.' });
      }
      if (result.code === 'PERMISSION_DENIED') {
        return t('clientsPage.deletePermissionDenied', {
          defaultValue: 'Permission denied: Cannot delete clients.',
        });
      }
      return result.message;
    })();

    return {
      ...result,
      message,
      dependencies: result.dependencies.map((dependency) => ({
        ...dependency,
        label: dependencyLabel(dependency.type, dependency.count, dependency.label),
      })),
      alternatives: result.alternatives.map((alternative) => {
        if (alternative.action === 'deactivate_client_only') {
          return {
            ...alternative,
            label: t('clientDetails.clientOnly', { defaultValue: 'Client Only' }),
            description: t('clientDetails.deactivateClientOnlyDescription', {
              defaultValue: 'Deactivate the client but leave its contacts active.',
            }),
          };
        }

        if (alternative.action === 'deactivate') {
          return {
            ...alternative,
            label: hasClientOnlyAlternative
              ? t('clientDetails.clientAndContacts', { defaultValue: 'Client & Contacts' })
              : t('clientsPage.markAsInactive', { defaultValue: 'Mark as Inactive' }),
            description: t('clientDetails.deactivateClientDescription', {
              defaultValue: 'Deactivates the record without deleting its data.',
            }),
          };
        }

        return alternative;
      }),
    };
  }, [t]);

  const resetDeleteState = useCallback(() => {
    setIsDeleteDialogOpen(false);
    setDeleteValidation(null);
  }, []);

  const runDeleteValidation = useCallback(async () => {
    if (!editedClient?.client_id) return;
    setIsDeleteValidating(true);
    try {
      const result = await validateClientDeletion(editedClient.client_id);
      setDeleteValidation(localizeClientDeleteValidation(result));
    } catch (err) {
      console.error('Failed to validate client deletion:', err);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('clientDetails.deleteValidationError', {
          defaultValue: 'Failed to validate deletion. Please try again.',
        }),
        dependencies: [],
        alternatives: [],
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [editedClient?.client_id, localizeClientDeleteValidation, t]);

  const handleDeleteClient = useCallback(() => {
    setIsDeleteDialogOpen(true);
    void runDeleteValidation();
  }, [runDeleteValidation]);

  const confirmDelete = useCallback(async () => {
    if (!editedClient?.client_id) return;
    setIsDeleteProcessing(true);
    try {
      const result = await deleteClient(editedClient.client_id);

      if (!result.success) {
        setDeleteValidation(localizeClientDeleteValidation(result));
        return;
      }

      resetDeleteState();
      toast.success(t('clientDetails.deleteSuccess', {
        defaultValue: 'Client has been deleted successfully.',
      }));

      if (isInDrawer) {
        onClose?.();
        drawer.closeDrawer();
      } else {
        router.push('/msp/clients');
      }
    } catch (err) {
      console.error('Failed to delete client:', err);
      toast.error(t('clientDetails.deleteError'));
    } finally {
      setIsDeleteProcessing(false);
    }
  }, [drawer, editedClient?.client_id, isInDrawer, localizeClientDeleteValidation, onClose, resetDeleteState, router, t]);

  const handleMarkClientInactiveAll = useCallback(async () => {
    if (!editedClient?.client_id) return;
    try {
      const result = await markClientInactiveWithContacts(editedClient.client_id, true);
      if (!result.success) {
        handleError(new Error(result.message || 'Failed to mark client as inactive'));
        resetDeleteState();
        return;
      }

      setClientInactiveState(true);
      toast.success(result.contactsDeactivated > 0
        ? t('clientDetails.deactivateWithContactsSuccess', {
            defaultValue: 'Client and {{count}} contacts have been deactivated successfully.',
            count: result.contactsDeactivated,
          })
        : t('clientDetails.inactiveSuccess', {
            defaultValue: 'Client has been marked as inactive successfully.',
          }));
      resetDeleteState();
      router.refresh();
    } catch (err) {
      handleError(err, 'An error occurred while marking the client as inactive. Please try again.');
      resetDeleteState();
    }
  }, [editedClient?.client_id, resetDeleteState, router, setClientInactiveState, t]);

  const handleMarkClientInactiveOnly = useCallback(async () => {
    if (!editedClient?.client_id) return;
    try {
      const result = await markClientInactiveWithContacts(editedClient.client_id, false);
      if (!result.success) {
        handleError(new Error(result.message || 'Failed to mark client as inactive'));
        resetDeleteState();
        return;
      }

      setClientInactiveState(true);
      toast.success(t('clientDetails.inactiveSuccess', {
        defaultValue: 'Client has been marked as inactive successfully.',
      }));
      resetDeleteState();
      router.refresh();
    } catch (err) {
      handleError(err, 'An error occurred while marking the client as inactive. Please try again.');
      resetDeleteState();
    }
  }, [editedClient?.client_id, resetDeleteState, router, setClientInactiveState, t]);

  const handleDeleteAlternativeAction = useCallback(async (action: string) => {
    setIsDeleteProcessing(true);
    try {
      if (action === 'deactivate') {
        await handleMarkClientInactiveAll();
      } else if (action === 'deactivate_client_only') {
        await handleMarkClientInactiveOnly();
      }
    } finally {
      setIsDeleteProcessing(false);
    }
  }, [handleMarkClientInactiveAll, handleMarkClientInactiveOnly]);

  const handleSyncEntraNow = useCallback(async () => {
    if (isSyncingEntra || !editedClient?.client_id) return;

    setIsSyncingEntra(true);
    try {
      const result = await startClientEntraSync({ clientId: editedClient.client_id });

      if ('error' in result) {
        toast.error(result.error || t('clientDetails.entraSyncError', {
          defaultValue: 'Failed to start Entra sync.',
        }));
        return;
      }

      if (!result.success) {
        toast.error(t('clientDetails.entraSyncError', {
          defaultValue: 'Failed to start Entra sync.',
        }));
        return;
      }

      const syncState = resolveEntraClientSyncStartState(result.data?.workflowId || result.data?.runId);
      if (syncState.shouldPoll && syncState.runId) {
        setEntraSyncRunId(syncState.runId);
        setEntraSyncStatus(syncState.statusMessage);
        toast.success(t('clientDetails.entraSyncStarted', { runId: syncState.runId }));
      } else {
        setEntraSyncStatus(syncState.statusMessage);
        toast.success(syncState.statusMessage);
      }
    } catch (err) {
      toast.error(err instanceof Error
        ? err.message
        : t('clientDetails.entraSyncError', { defaultValue: 'Failed to start Entra sync.' }));
    } finally {
      setIsSyncingEntra(false);
    }
  }, [editedClient?.client_id, isSyncingEntra, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !client || !editedClient) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || t('clientQuickView.unknownError', { defaultValue: 'Something went wrong' })}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <ReflectionContainer id={id} label={t('clientDetails.title', { defaultValue: 'Client Details' })}>
      <div className="flex items-center space-x-5 mb-4 pt-2">
        <div className="flex items-center space-x-3">
          <EntityImageUpload
            entityType="client"
            entityId={editedClient.client_id}
            entityName={editedClient.client_name}
            imageUrl={editedClient.logoUrl ?? null}
            uploadAction={uploadClientLogo}
            deleteAction={deleteClientLogo}
            onImageChange={(newLogoUrl) => {
              setEditedClient((prev) => prev ? { ...prev, logoUrl: newLogoUrl } : prev);
            }}
            size="md"
          />
        </div>

        <div className="flex-1 flex items-center justify-between">
          <Heading size="6" tabIndex={0} autoFocus>
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
              {t('clientDetails.openInNewTab', { defaultValue: 'Open in new tab' })}
            </Button>
          )}

          <div className="flex items-center gap-2 mr-8" data-print-hide>
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
                  {t('clientDetails.syncEntraNow', { defaultValue: 'Sync Entra Now' })}
                </Button>
                {entraSyncStatus ? (
                  <p
                    className="text-xs text-muted-foreground"
                    id={`${id}-sync-entra-status`}
                    title={entraSyncRunId || undefined}
                  >
                    {entraSyncStatus}
                  </p>
                ) : null}
              </div>
            )}
            <PrintButton id={`${id}-print-button`} variant="outline" size="sm" />
            <Button
              id={`${id}-delete-client-button`}
              onClick={handleDeleteClient}
              variant="destructive"
              size="sm"
              className="flex items-center"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('common.actions.delete', { defaultValue: 'Delete' })}
            </Button>
          </div>
        </div>
      </div>

      <div data-print-region data-print-title={editedClient.client_name}>
        <CustomTabs
          tabs={[{
            id: 'details',
            label: t('clientDetails.details', { defaultValue: 'Details' }),
            content: (
              <ClientDetailsTabContent
                id={id}
                editedClient={editedClient}
                tags={tags}
                internalUsers={internalUsers}
                isLoadingUsers={isLoadingUsers}
                clientActiveContacts={clientActiveContacts}
                setDefaultContactOptions={setDefaultContactOptions}
                fieldErrors={fieldErrors}
                hasAttemptedSubmit={hasAttemptedSubmit}
                slaPolicies={slaPolicies}
                isLoadingSlaPolicies={isLoadingSlaPolicies}
                isInDrawer={isInDrawer}
                locationsRefreshKey={locationsRefreshKey}
                surveySummary={null}
                inboundDestinationOptions={inboundDestinationOptions}
                isInboundDestinationOptionsLoading={isInboundDestinationOptionsLoading}
                inboundEmailDomains={inboundEmailDomains}
                inboundDomainDraft={inboundDomainDraft}
                setInboundDomainDraft={setInboundDomainDraft}
                isInboundDomainBusy={isInboundDomainBusy}
                normalizeInboundDomain={normalizeInboundDomain}
                clientNameAliases={clientNameAliases}
                aliasDraft={aliasDraft}
                setAliasDraft={setAliasDraft}
                isAliasBusy={isAliasBusy}
                isSaving={isSaving}
                t={t}
                onFieldChange={handleFieldChange}
                onDefaultContactChange={handleDefaultContactChange}
                onAddInboundDomain={handleAddInboundDomain}
                onRemoveInboundDomain={handleRemoveInboundDomain}
                onAddClientNameAlias={handleAddClientNameAlias}
                onRemoveClientNameAlias={handleRemoveClientNameAlias}
                onTagsChange={setTags}
                onManageLocations={() => setIsLocationsDialogOpen(true)}
                onSave={handleSave}
                onAddTicket={() => setIsQuickAddTicketOpen(true)}
                renderSurveySummaryCard={renderSurveySummaryCard}
              />
            ),
          }]}
          defaultTab="details"
        />

        {renderQuickAddTicket({
          id: `${id}-quick-add-ticket`,
          open: isQuickAddTicketOpen,
          onOpenChange: setIsQuickAddTicketOpen,
          onTicketAdded: () => setIsQuickAddTicketOpen(false),
          prefilledClient: {
            id: editedClient.client_id,
            name: editedClient.client_name,
          },
        })}

        <Dialog
          isOpen={isLocationsDialogOpen}
          onClose={() => {
            setIsLocationsDialogOpen(false);
            setLocationsRefreshKey((prev) => prev + 1);
          }}
          title={t('clientDetails.manageLocations', { defaultValue: 'Manage Locations' })}
        >
          <DialogContent className="max-w-4xl">
            <ClientLocations clientId={editedClient.client_id} isEditing={true} />
          </DialogContent>
        </Dialog>

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

        <ConfirmationDialog
          id="deactivate-client-dialog"
          isOpen={isDeactivateDialogOpen}
          onClose={() => setIsDeactivateDialogOpen(false)}
          onConfirm={() => handleDeactivateClient(true)}
          title={t('clientDetails.deactivateClient', { defaultValue: 'Deactivate Client' })}
          message={
            <div className="space-y-3">
              <p>
                {t('clientDetails.deactivatePrompt', {
                  defaultValue: 'This client has {{count}} active contact(s). Would you like to deactivate them as well?',
                  count: activeContactsToDeactivate.length,
                })}
              </p>
              {activeContactsToDeactivate.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    {t('clientDetails.activeContacts', { defaultValue: 'Active contacts:' })}
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 max-h-40 overflow-y-auto">
                    {activeContactsToDeactivate.map((contact) => (
                      <li key={contact.contact_name_id}>
                        {contact.full_name || contact.email}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          }
          confirmLabel={t('clientDetails.deactivateClientAndContacts', { defaultValue: 'Deactivate Client & Contacts' })}
          cancelLabel={t('clientDetails.clientOnly', { defaultValue: 'Client Only' })}
          onCancel={() => handleDeactivateClient(false)}
        />

        <ConfirmationDialog
          id="reactivate-client-dialog"
          isOpen={isReactivateDialogOpen}
          onClose={() => setIsReactivateDialogOpen(false)}
          onConfirm={() => handleReactivateClient(true)}
          title={t('clientDetails.reactivateClient', { defaultValue: 'Reactivate Client' })}
          message={
            <div className="space-y-3">
              <p>
                {t('clientDetails.reactivatePrompt', {
                  defaultValue: 'This client has {{count}} inactive contact(s). Would you like to reactivate them as well?',
                  count: inactiveContactsToReactivate.length,
                })}
              </p>
              {inactiveContactsToReactivate.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    {t('clientDetails.inactiveContacts', { defaultValue: 'Inactive contacts:' })}
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 max-h-40 overflow-y-auto">
                    {inactiveContactsToReactivate.map((contact) => (
                      <li key={contact.contact_name_id}>
                        {contact.full_name || contact.email}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          }
          confirmLabel={t('clientDetails.reactivateClientAndContacts', { defaultValue: 'Reactivate Client & Contacts' })}
          cancelLabel={t('clientDetails.clientOnly', { defaultValue: 'Client Only' })}
          onCancel={() => handleReactivateClient(false)}
        />
      </div>
    </ReflectionContainer>
  );
};

export default ClientQuickView;
