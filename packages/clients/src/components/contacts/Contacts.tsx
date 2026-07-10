'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { DeletionValidationResult, IContact } from '@alga-psa/types';
import type { IClient } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import type { IDocument } from '@alga-psa/types';
import { getAllContacts, getContactsByClient, getAllClients, searchContactListIds } from '@alga-psa/clients/actions';
import { exportContactsToCSV, deleteContact, updateContact, getContactLastUsagePhoneTypes, deleteOrphanedPhoneTypes } from '@alga-psa/clients/actions';
import { findTagsByEntityIds, findAllTagsByType, isTagActionError } from '@alga-psa/tags/actions';
import { Button } from '@alga-psa/ui/components/Button';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import {
  DropdownMenuContent as StyledDropdownMenuContent,
  DropdownMenuItem as StyledDropdownMenuItem,
  DropdownMenuSeparator as StyledDropdownMenuSeparator,
} from '@alga-psa/ui/components/DropdownMenu';
import { usePrintAction } from '@alga-psa/ui/components/PrintButton';
import {
  PrintOptionsDialog,
  type PrintColumnOption,
  usePrintColumnSelection,
} from '@alga-psa/ui/components/PrintOptionsDialog';
import { PrintableTable } from '@alga-psa/ui/components/PrintableTable';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import { Pen, Eye, CloudDownload, MoreVertical, Upload, Trash2, XCircle, ExternalLink, Power, RotateCcw, Printer, Settings2, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import QuickAddContact from './QuickAddContact';
import { useDrawer, useClientDrawer } from "@alga-psa/ui";
import ContactQuickView from './bento/ContactQuickView';
import ContactsImportDialog from './ContactsImportDialog';
import ClientQuickView from '../clients/ClientQuickView';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import ClientNameCell from '@alga-psa/ui/components/ClientNameCell';
import { ColumnDefinition } from '@alga-psa/types';
import { TagFilter } from '@alga-psa/ui/components';
import { TagManager } from '@alga-psa/tags/components';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import { getUniqueTagTexts } from '@alga-psa/ui';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { getCurrentUserAsync } from '../../lib/usersHelpers';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import { useRouter } from 'next/navigation';
import ContactsSkeleton from './ContactsSkeleton';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ShortcutActiveRegion, usePageCreateShortcut } from '@alga-psa/ui/keyboard-shortcuts';

const CONTACTS_PAGE_SIZE_SETTING = 'contacts_page_size';
const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface ContactsProps {
  initialContacts: IContact[];
  clientId?: string;
  preSelectedClientId?: string;
}

const Contacts: React.FC<ContactsProps> = ({ initialContacts, clientId, preSelectedClientId }) => {
  const { t } = useTranslation('msp/contacts');
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['contact']);
  const { getDocumentsByEntity } = useDocumentsCrossFeature();

  // Use user preference for page size
  const {
    value: pageSize,
    setValue: setPageSize
  } = useUserPreference<number>(
    CONTACTS_PAGE_SIZE_SETTING,
    {
      defaultValue: 10,
      localStorageKey: CONTACTS_PAGE_SIZE_SETTING,
      debounceMs: 300
    }
  );
  
  const [contacts, setContacts] = useState<IContact[]>(initialContacts);

  // Sync state when initialContacts changes (e.g., from router.refresh())
  useEffect(() => {
    setContacts(initialContacts);
  }, [initialContacts]);

  const [clients, setClients] = useState<IClient[]>([]);
  const [documents, setDocuments] = useState<Record<string, IDocument[]>>({});
  const [documentLoading, setDocumentLoading] = useState<Record<string, boolean>>({});
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [indexedSearchContactIds, setIndexedSearchContactIds] = useState<Set<string> | null>(null);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isFiltered, setIsFiltered] = useState(false);
  const [sortBy, setSortBy] = useState<string>('full_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const openQuickAddContact = useCallback(() => setIsQuickAddOpen(true), []);
  usePageCreateShortcut(openQuickAddContact);
  const { openDrawer } = useDrawer();
  const clientDrawer = useClientDrawer();
  const router = useRouter();
  const contactTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  const [tagsVersion, setTagsVersion] = useState(0); // Used to force re-render when tags are fetched
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<IContact | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
  const [lastUsagePhoneTypes, setLastUsagePhoneTypes] = useState<Array<{ contact_phone_type_id: string; label: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [changesSavedInDrawer, setChangesSavedInDrawer] = useState(false);

  const statusOptions = useMemo(() => [
    {
      value: 'all',
      label: t('contactsPage.statusOptions.all', { defaultValue: 'All contacts' })
    },
    {
      value: 'active',
      label: t('contactsPage.statusOptions.active', { defaultValue: 'Active contacts' })
    },
    {
      value: 'inactive',
      label: t('contactsPage.statusOptions.inactive', { defaultValue: 'Inactive contacts' })
    }
  ], [t]);

  const refreshContacts = async () => {
    // Force refresh by changing a key to trigger re-render
    setRefreshKey(prev => prev + 1);
  };

  // This list fetches its own data client-side, so router.refresh() (used by the global
  // quick-create) won't reload it. Listen for the quick-create "created" event and re-fetch.
  // Event name is mirrored in QuickCreateDialog.tsx.
  useEffect(() => {
    const onCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ entity?: string }>).detail;
      if (detail?.entity === 'contact') {
        setRefreshKey(prev => prev + 1);
      }
    };
    window.addEventListener('alga:quick-create:created', onCreated);
    return () => window.removeEventListener('alga:quick-create:created', onCreated);
  }, []);

  const handleChangesSaved = () => {
    setChangesSavedInDrawer(true);
  };

  const handleDrawerClose = () => {
    if (changesSavedInDrawer) {
      refreshContacts();
      setChangesSavedInDrawer(false);
    }
  };

  const handleSortChange = (newSortBy: string, newSortDirection: 'asc' | 'desc') => {
    setSortBy(newSortBy);
    setSortDirection(newSortDirection);
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  // Fetch contacts and clients when filter status or sorting changes
  useEffect(() => {
    const fetchContactsAndClients = async () => {
      // Only show loading for the first load and major filter changes, not for sorting
      const isInitialLoad = contacts.length === 0;
      const isFilterChange = refreshKey > 0;

      if (isInitialLoad || isFilterChange) {
        setIsLoading(true);
      }

      try {
        let fetchedContacts: IContact[] = [];

        // Fetch contacts based on filter status
        if (clientId) {
          if (filterStatus === 'all') {
            fetchedContacts = await getContactsByClient(clientId, 'all', sortBy, sortDirection);
          } else if (filterStatus === 'active') {
            fetchedContacts = await getContactsByClient(clientId, 'active', sortBy, sortDirection);
          } else { // 'inactive'
            fetchedContacts = await getContactsByClient(clientId, 'inactive', sortBy, sortDirection);
          }
        } else {
          if (filterStatus === 'all') {
            fetchedContacts = await getAllContacts('all', sortBy, sortDirection);
          } else if (filterStatus === 'active') {
            fetchedContacts = await getAllContacts('active', sortBy, sortDirection);
          } else { // 'inactive'
            fetchedContacts = await getAllContacts('inactive', sortBy, sortDirection);
          }
        }

        // Only fetch clients and user data on initial load to avoid unnecessary refetches
        if (isInitialLoad || clients.length === 0) {
          const [allClients, userData] = await Promise.all([
            getAllClients(),
            getCurrentUserAsync()
          ]);

          setClients(allClients);
          if (userData?.user_id) {
            setCurrentUser(userData.user_id);
          }
        }

        setContacts(fetchedContacts);
      } catch (error) {
        console.error('Error fetching contacts and clients:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchContactsAndClients();
  }, [clientId, filterStatus, refreshKey, sortBy, sortDirection]);

  // Fetch tags separately - only fetch contact-specific tags when contacts change
  useEffect(() => {
    const fetchTags = async () => {
      if (contacts.length === 0) return;
      
      try {
        // Only fetch contact-specific tags, not all tags again
        const contactTags = await findTagsByEntityIds(
          contacts.map((contact: IContact): string => contact.contact_name_id),
          'contact'
        );
        if (isTagActionError(contactTags)) {
          console.error('Error fetching tags:', contactTags);
          return;
        }

        const newContactTags: Record<string, ITag[]> = {};
        contactTags.forEach(tag => {
          if (!newContactTags[tag.tagged_id]) {
            newContactTags[tag.tagged_id] = [];
          }
          newContactTags[tag.tagged_id].push(tag);
        });

        contactTagsRef.current = newContactTags;
        // Force re-render to show fetched tags
        setTagsVersion(v => v + 1);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [contacts]);

  // Fetch all unique tags only once on mount
  useEffect(() => {
    const fetchAllTags = async () => {
      try {
        const allTags = await findAllTagsByType('contact');
        if (isTagActionError(allTags)) {
          console.error('Error fetching all tags:', allTags);
          setAllUniqueTags([]);
          return;
        }
        setAllUniqueTags(allTags);
      } catch (error) {
        console.error('Error fetching all tags:', error);
      }
    };
    fetchAllTags();
  }, [t]);

  const handleTagsChange = (contactId: string, updatedTags: ITag[]) => {
    contactTagsRef.current = {
      ...contactTagsRef.current,
      [contactId]: updatedTags,
    };
    // Update unique tags list if needed
    setAllUniqueTags(current => {
      const currentTagTexts = new Set(current.map(t => t.tag_text));
      const newTags = updatedTags.filter(tag => !currentTagTexts.has(tag.tag_text));
      return [...current, ...newTags];
    });
  };

  const getClientName = useCallback((clientId: string) => {
    const client = clients.find(c => c.client_id === clientId);
    return client
      ? client.client_name
      : t('contactsPage.unknownClient', { defaultValue: 'Unknown Client' });
  }, [clients, t]);

  const handleContactAdded = (newContact: IContact) => {
    // Store tags for the new contact if provided
    if (newContact.contact_name_id && newContact.tags && newContact.tags.length > 0) {
      contactTagsRef.current[newContact.contact_name_id] = newContact.tags;

      // Update unique tags list with any new tags
      setAllUniqueTags(prevTags => {
        const currentTagTexts = new Set(prevTags.map(t => t.tag_text));
        const newUniqueTags = newContact.tags!.filter(tag => !currentTagTexts.has(tag.tag_text));
        if (newUniqueTags.length > 0) {
          return [...prevTags, ...newUniqueTags];
        }
        return prevTags;
      });
    }

    setContacts(prevContacts => [...prevContacts, newContact]);
  };



  const handleEditContact = (contact: IContact) => {
    // Navigate directly to the contact page for editing
    router.push(`/msp/contacts/${contact.contact_name_id}`);
  };

  const handleQuickView = async (contact: IContact) => {
    // If this is being used within a client context (clientId prop exists),
    // maintain the drawer behavior. Otherwise, open drawer with quick view functionality.
    if (clientId) {
      // Client context - keep existing drawer behavior for quick view
      if (!currentUser) return;

      try {
        setDocumentLoading(prev => ({
          ...prev,
          [contact.contact_name_id]: true
        }));

        const existingDocuments = documents[contact.contact_name_id];

        if (!existingDocuments || existingDocuments.length === 0) {
          const response = await getDocumentsByEntity(contact.contact_name_id, 'contact');

          if (!isActionPermissionError(response)) {
            setDocuments(prev => {
              const newDocuments = { ...prev };
              newDocuments[contact.contact_name_id] = Array.isArray(response)
                ? response
                : response.documents || [];
              return newDocuments;
            });
          }
        }

        openDrawer(
          <ContactQuickView
            contact={contact}
            clients={clients}
            documents={documents[contact.contact_name_id] || []}
            userId={currentUser}
            onDocumentCreated={async () => {
              try {
                const updatedResponse = await getDocumentsByEntity(contact.contact_name_id, 'contact');

                if (!isActionPermissionError(updatedResponse)) {
                  setDocuments(prev => {
                    const newDocuments = { ...prev };
                    newDocuments[contact.contact_name_id] = Array.isArray(updatedResponse)
                      ? updatedResponse
                      : updatedResponse.documents || [];
                    return newDocuments;
                  });
                }
              } catch (err) {
                console.error('Error refreshing documents:', err);
              }
            }}
            onChangesSaved={handleChangesSaved}
          />,
          undefined, // onMount
          handleDrawerClose // onClose
        );
      } catch (error) {
        console.error('Error fetching contact documents:', error);
      } finally {
        setDocumentLoading(prev => ({
          ...prev,
          [contact.contact_name_id]: false
        }));
      }
    } else {
      // Main contacts list - open drawer with quick view functionality
      if (!currentUser) return;

      try {
        setDocumentLoading(prev => ({
          ...prev,
          [contact.contact_name_id]: true
        }));

        const existingDocuments = documents[contact.contact_name_id];

        if (!existingDocuments || existingDocuments.length === 0) {
          const response = await getDocumentsByEntity(contact.contact_name_id, 'contact');

          if (!isActionPermissionError(response)) {
            setDocuments(prev => {
              const newDocuments = { ...prev };
              newDocuments[contact.contact_name_id] = Array.isArray(response)
                ? response
                : response.documents || [];
              return newDocuments;
            });
          }
        }

        openDrawer(
          <ContactQuickView
            contact={contact}
            clients={clients}
            documents={documents[contact.contact_name_id] || []}
            userId={currentUser}
            onDocumentCreated={async () => {
              try {
                const updatedResponse = await getDocumentsByEntity(contact.contact_name_id, 'contact');

                if (!isActionPermissionError(updatedResponse)) {
                  setDocuments(prev => {
                    const newDocuments = { ...prev };
                    newDocuments[contact.contact_name_id] = Array.isArray(updatedResponse)
                      ? updatedResponse
                      : updatedResponse.documents || [];
                    return newDocuments;
                  });
                }
              } catch (err) {
                console.error('Error refreshing documents:', err);
              }
            }}
            onChangesSaved={handleChangesSaved}
          />,
          undefined, // onMount
          handleDrawerClose // onClose
        );
      } catch (error) {
        console.error('Error fetching contact documents:', error);
      } finally {
        setDocumentLoading(prev => ({
          ...prev,
          [contact.contact_name_id]: false
        }));
      }
    }
  };

  const runDeleteValidation = useCallback(async (contactId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('contact', contactId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Failed to validate contact deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('contactsPage.deleteValidationError', {
          defaultValue: 'Failed to validate deletion. Please try again.'
        }),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, []);

  const handleDeleteContact = (contact: IContact) => {
    setContactToDelete(contact);
    setIsDeleteDialogOpen(true);
    void runDeleteValidation(contact.contact_name_id);
  };

  const confirmDelete = async () => {
    if (!contactToDelete) return;

    setIsDeleteProcessing(true);
    try {
      // Check for last-usage custom phone types before deleting
      const lastUsageTypes = await getContactLastUsagePhoneTypes(contactToDelete.contact_name_id);

      const result = await deleteContact(contactToDelete.contact_name_id);

      if (result.success) {
        setContacts(prevContacts =>
          prevContacts.filter(c => c.contact_name_id !== contactToDelete.contact_name_id)
        );

        resetDeleteState();
        toast.success(
          t('contactsPage.deleteSuccess', {
            defaultValue: '{{name}} has been deleted successfully.',
            name: contactToDelete.full_name
          })
        );

        // If there are orphaned phone types, ask the user what to do
        if (lastUsageTypes.length > 0) {
          setLastUsagePhoneTypes(lastUsageTypes);
        }
      } else {
        setDeleteValidation(result);
      }
    } catch (err) {
      handleError(
        err,
        t('contactsPage.deleteError', {
          defaultValue: 'Failed to delete contact. Please try again.'
        })
      );
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
      await handleMarkContactInactive();
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const handleMarkContactInactive = async () => {
    if (!contactToDelete) return;

    try {
      const updatedContact = await updateContact({
        ...contactToDelete,
        is_inactive: true
      });
      if (isReturnedActionError(updatedContact)) {
        handleError(updatedContact);
        return;
      }

      // Update contact in the list to reflect inactive status
      setContacts(prevContacts =>
        prevContacts.map(c =>
          c.contact_name_id === contactToDelete.contact_name_id
            ? updatedContact
            : c
        )
      );

      resetDeleteState();
      toast.success(
        t('contactsPage.markInactiveSuccess', {
          defaultValue: '{{name}} has been marked as inactive successfully.',
          name: contactToDelete.full_name
        })
      );
    } catch (error: any) {
      handleError(
        error,
        t('contactsPage.markInactiveError', {
          defaultValue: 'An error occurred while marking the contact as inactive. Please try again.'
        })
      );
    }
  };

  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setContactToDelete(null);
    setDeleteValidation(null);
  };

  const handleConfirmDeletePhoneTypes = async () => {
    try {
      const labels = lastUsagePhoneTypes.map(t => t.label);
      await deleteOrphanedPhoneTypes(labels);
    } catch (err) {
      console.error('Error deleting orphaned phone types:', err);
    }
    setLastUsagePhoneTypes([]);
  };

  const handleKeepPhoneTypes = () => {
    setLastUsagePhoneTypes([]);
  };

  const handleExportToCSV = async () => {
    try {
      const csvData = await exportContactsToCSV(filteredContacts, clients, contactTagsRef.current);

      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });

      const link = document.createElement('a');
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'contacts.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Error exporting contacts to CSV:', error);
    }
  };

  const handleImportComplete = (newContacts: IContact[]) => {
    setContacts(prev => [...prev, ...newContacts]);
    setIsImportDialogOpen(false);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page when page size changes
  };


  const columns: ColumnDefinition<IContact>[] = [
    {
      title: t('contactsPage.table.name', { defaultValue: 'Name' }),
      dataIndex: 'full_name',
      width: '20%',
      render: (value, record): React.ReactNode => (
        <div className="flex items-center">
          <ContactAvatar
            contactId={record.contact_name_id}
            contactName={record.full_name}
            avatarUrl={record.avatarUrl || null}
            size="sm"
            className="mr-2"
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleEditContact(record)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleEditContact(record);
              }
            }}
            className="text-blue-600 hover:underline cursor-pointer"
          >
            {record.full_name}
          </div>
        </div>
      ),
    },
    {
      title: t('contactsPage.table.created', { defaultValue: 'Created' }),
      dataIndex: 'created_at',
      width: '12%',
      render: (value, record): React.ReactNode => {
        if (!record.created_at) {
          return t('common.states.na', { defaultValue: 'N/A' });
        }
        const date = new Date(record.created_at);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      },
    },
    {
      title: t('contactsPage.table.email', { defaultValue: 'Email' }),
      dataIndex: 'email',
      width: '18%',
      render: (value, record): React.ReactNode =>
        record.email || t('common.states.na', { defaultValue: 'N/A' }),
    },
    {
      title: t('contactsPage.table.phoneNumber', { defaultValue: 'Phone Number' }),
      dataIndex: 'default_phone_number',
      sortable: false,
      width: '15%',
      render: (value, record): React.ReactNode =>
        record.default_phone_number
        || record.phone_numbers?.find((phoneNumber: any) => phoneNumber.is_default)?.phone_number
        || t('common.states.na', { defaultValue: 'N/A' }),
    },
    {
      title: t('contactsPage.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      width: '13%',
      render: (value, record): React.ReactNode => {
        const clientId = record.client_id;
        if (typeof clientId !== 'string' || !clientId) {
          return <ClientNameCell clientName={null} />;
        }

        const client = clients.find(c => c.client_id === clientId);
        if (!client) {
          return <ClientNameCell clientId={clientId} clientName={getClientName(clientId)} />;
        }

        const handleClientOpen = () => {
          if (clientDrawer) {
            clientDrawer.openClientDrawer(client.client_id);
            return;
          }
          openDrawer(
            <ClientQuickView
              client={client}
              isInDrawer={true}
              quickView={true}
            />
          );
        };

        return (
          <ClientNameCell clientId={client.client_id} clientName={client.client_name} logoUrl={client.logoUrl ?? null}>
            <div
              role="button"
              tabIndex={0}
              onClick={handleClientOpen}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleClientOpen();
                }
              }}
              className="text-blue-600 hover:underline cursor-pointer truncate"
            >
              {client.client_name}
            </div>
          </ClientNameCell>
        );
      },
    },
    {
      title: t('contactsPage.table.tags', { defaultValue: 'Tags' }),
      dataIndex: 'tags',
      sortable: false,
      width: '15%',
      render: (value, record): React.ReactNode => {
        if (!record.contact_name_id) return null;

        return (
          <TagManager
            entityId={record.contact_name_id}
            entityType="contact"
            initialTags={contactTagsRef.current[record.contact_name_id] || []}
            onTagsChange={(tags) => handleTagsChange(record.contact_name_id, tags)}
          />
        );
      },
    },
    {
      title: t('contactsPage.table.actions', { defaultValue: 'Actions' }),
      dataIndex: 'actions',
      sortable: false,
      width: '3%',
      render: (value, record): React.ReactNode => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              variant="ghost"
              id="contacts-actions-menu"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <span className="sr-only">
                {t('contactsPage.actionsMenuSrOnly', { defaultValue: 'Open menu' })}
              </span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content 
            align="end" 
            className="bg-white rounded-md shadow-lg p-1 border border-gray-200 min-w-[120px] z-50"
          >
            <DropdownMenu.Item 
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center rounded"
              onSelect={() => handleQuickView(record)}
            >
              <ExternalLink size={14} className="mr-2" />
              {t('contactsPage.quickView', { defaultValue: 'Quick View' })}
            </DropdownMenu.Item>
            <DropdownMenu.Item 
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center rounded"
              onSelect={() => handleEditContact(record)}
            >
              <Pen size={14} className="mr-2" />
              {t('common.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenu.Item>
            <DropdownMenu.Item 
              className="px-2 py-1 text-sm cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center rounded"
              onSelect={() => handleDeleteContact(record)}
            >
              <Trash2 size={14} className="mr-2" />
              {t('common.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      ),
    },
  ];

  useEffect(() => {
    const query = searchTerm.trim();
    if (!query) {
      setIndexedSearchContactIds(null);
      return;
    }

    setIndexedSearchContactIds(null);
    let isCancelled = false;
    const timeout = setTimeout(() => {
      searchContactListIds(query)
        .then((contactIds) => {
          if (!isCancelled) {
            setIndexedSearchContactIds(new Set(contactIds));
          }
        })
        .catch((error) => {
          console.error('Error searching contacts:', error);
          if (!isCancelled) {
            setIndexedSearchContactIds(new Set());
          }
        });
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timeout);
    };
  }, [searchTerm]);

  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      const searchTermLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTermLower ||
                          (indexedSearchContactIds
                            ? indexedSearchContactIds.has(contact.contact_name_id) ||
                              contact.full_name.toLowerCase().includes(searchTermLower) ||
                              (contact.email && contact.email.toLowerCase().includes(searchTermLower)) ||
                              contact.additional_email_addresses?.some((emailAddress) =>
                                emailAddress.email_address.toLowerCase().includes(searchTermLower)
                              )
                            : contact.full_name.toLowerCase().includes(searchTermLower) ||
                              (contact.email && contact.email.toLowerCase().includes(searchTermLower)) ||
                              contact.additional_email_addresses?.some((emailAddress) =>
                                emailAddress.email_address.toLowerCase().includes(searchTermLower)
                              ));
      const matchesStatus = filterStatus === 'all' ||
        (filterStatus === 'active' && !contact.is_inactive) ||
        (filterStatus === 'inactive' && contact.is_inactive);

      const matchesTags = selectedTags.length === 0 || (
        contactTagsRef.current[contact.contact_name_id]?.some(tag =>
          selectedTags.includes(tag.tag_text)
        )
      );

      return matchesSearch && matchesStatus && matchesTags;
    });
  }, [contacts, searchTerm, filterStatus, selectedTags, indexedSearchContactIds]);

  // Memoize the data transformation for DataTable
  const tableData = useMemo(() => filteredContacts.map((contact) => ({
    ...contact,
    id: contact.contact_name_id
  })), [filteredContacts]);

  const printColumns = useMemo<PrintColumnOption<IContact>[]>(() => [
    {
      key: 'full_name',
      label: t('contactsPage.table.name', { defaultValue: 'Name' }),
      header: t('contactsPage.table.name', { defaultValue: 'Name' }),
      render: (contact) => contact.full_name,
    },
    {
      key: 'created_at',
      label: t('contactsPage.table.created', { defaultValue: 'Created' }),
      header: t('contactsPage.table.created', { defaultValue: 'Created' }),
      render: (contact) => contact.created_at
        ? new Date(contact.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : t('common.states.na', { defaultValue: 'N/A' }),
    },
    {
      key: 'email',
      label: t('contactsPage.table.email', { defaultValue: 'Email' }),
      header: t('contactsPage.table.email', { defaultValue: 'Email' }),
      render: (contact) => contact.email || t('contactsPage.print.emptyValue', { defaultValue: '-' }),
    },
    {
      key: 'default_phone_number',
      label: t('contactsPage.table.phoneNumber', { defaultValue: 'Phone Number' }),
      header: t('contactsPage.table.phoneNumber', { defaultValue: 'Phone Number' }),
      render: (contact) => contact.default_phone_number
        || contact.phone_numbers?.find((phoneNumber: any) => phoneNumber.is_default)?.phone_number
        || contact.phone_numbers?.[0]?.phone_number
        || t('contactsPage.print.emptyValue', { defaultValue: '-' }),
    },
    {
      key: 'client_name',
      label: t('contactsPage.table.client', { defaultValue: 'Client' }),
      header: t('contactsPage.table.client', { defaultValue: 'Client' }),
      render: (contact) => contact.client_id
        ? getClientName(contact.client_id)
        : t('contactsPage.noClient', { defaultValue: 'No Client' }),
    },
    {
      key: 'tags',
      label: t('contactsPage.table.tags', { defaultValue: 'Tags' }),
      header: t('contactsPage.table.tags', { defaultValue: 'Tags' }),
      render: (contact) => {
        const tags = contact.contact_name_id ? contactTagsRef.current[contact.contact_name_id] ?? [] : [];
        return tags.length > 0
          ? tags.map((tag) => tag.tag_text).join(', ')
          : t('contactsPage.print.emptyValue', { defaultValue: '-' });
      },
    },
    {
      key: 'status',
      label: t('contactsPage.print.columns.status', { defaultValue: 'Status' }),
      header: t('contactsPage.print.columns.status', { defaultValue: 'Status' }),
      render: (contact) => contact.is_inactive
        ? t('common.states.inactive', { defaultValue: 'Inactive' })
        : t('common.states.active', { defaultValue: 'Active' }),
    },
  ], [t, getClientName]);
  const {
    selectedColumnKeys: selectedContactPrintColumnKeys,
    selectedColumns: selectedContactPrintColumns,
    setSelectedColumnKeys: setSelectedContactPrintColumnKeys,
    resetSelectedColumnKeys: resetSelectedContactPrintColumnKeys,
  } = usePrintColumnSelection('print-columns:contacts-list', printColumns);

  const [isPrintOptionsOpen, setIsPrintOptionsOpen] = useState(false);

  const { triggerPrint: triggerPrintContacts, isPreparing: isPreparingContactPrint } = usePrintAction();

  if (isLoading) {
    return <ContactsSkeleton />;
  }

  return (
    <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">
            {t('contactsPage.heading', { defaultValue: 'Contacts' })}
          </h1>
          <div className="flex items-center gap-2">
            <Button
              id="new-contact-dialog-button"
              onClick={openQuickAddContact}
            >
              {t('contactsPage.addContact', { defaultValue: '+ Add Contact' })}
            </Button>
            <DropdownMenu.Root>
              <Tooltip content={t('contactsPage.shareTooltip', { defaultValue: 'Print, import and export' })}>
                <DropdownMenu.Trigger asChild>
                  <Button
                    id="contacts-actions-button"
                    variant="outline"
                    size="default"
                    className="w-10 px-0"
                    aria-label={t('contactsPage.shareTooltip', { defaultValue: 'Print, import and export' })}
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                </DropdownMenu.Trigger>
              </Tooltip>
              <StyledDropdownMenuContent align="end" className="w-56">
                <StyledDropdownMenuItem
                  onSelect={(event) => { event.preventDefault(); void triggerPrintContacts(); }}
                  disabled={isPreparingContactPrint}
                  className="gap-2"
                >
                  <Printer className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">{t('actions.print', { defaultValue: 'Print' })}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem
                  onSelect={(event) => { event.preventDefault(); setIsPrintOptionsOpen(true); }}
                  className="gap-2"
                >
                  <Settings2 className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">{t('actions.printOptions', { defaultValue: 'Print options' })}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuSeparator />
                <StyledDropdownMenuItem
                  onSelect={() => setIsImportDialogOpen(true)}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">{t('common.actions.uploadCsv', { defaultValue: 'Upload CSV' })}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem
                  onSelect={() => void handleExportToCSV()}
                  className="gap-2"
                >
                  <CloudDownload className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                  <span className="flex-1">{t('common.actions.downloadCsv', { defaultValue: 'Download CSV' })}</span>
                </StyledDropdownMenuItem>
              </StyledDropdownMenuContent>
            </DropdownMenu.Root>
          </div>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <ReflectionContainer id='filters'>
            <div className="flex items-center mb-4 gap-4">
                <SearchInput
                  id='filter-contacts'
                  placeholder={t('contactsPage.searchPlaceholder', {
                    defaultValue: 'Search contacts, notes, and interactions'
                  })}
                  className="w-64"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setIsFiltered(e.target.value !== '' || selectedTags.length > 0 || filterStatus !== 'active');
                  }}
                  onClear={() => {
                    setSearchTerm('');
                    setIsFiltered(selectedTags.length > 0 || filterStatus !== 'active');
                  }}
                />

                <TagFilter
                  tags={allUniqueTags}
                  selectedTags={selectedTags}
                  onToggleTag={(tag: string) => {
                    setSelectedTags(prev => {
                      const newTags = prev.includes(tag)
                        ? prev.filter(t => t !== tag)
                        : [...prev, tag];
                      setIsFiltered(searchTerm !== '' || newTags.length > 0 || filterStatus !== 'active');
                      return newTags;
                    });
                  }}
                  onClearTags={() => setSelectedTags([])}
                />

                <CustomSelect
                  id='filter-status'
                  value={filterStatus}
                  onValueChange={(value) => {
                    const newStatus = value as 'all' | 'active' | 'inactive';
                    setFilterStatus(newStatus);
                    setIsFiltered(searchTerm !== '' || selectedTags.length > 0 || newStatus !== 'active');
                  }}
                  options={statusOptions}
                  className="min-w-[180px]"
                />
                <Button
                  id="reset-filters-button"
                  variant="ghost"
                  size="sm"
                  className={`shrink-0 flex items-center gap-1 ${isFiltered ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedTags([]);
                    setFilterStatus('active');
                    setIsFiltered(false);
                  }}
                  disabled={!isFiltered}
                >
                  <XCircle className="h-4 w-4" />
                  {t('contactsPage.resetFilters', { defaultValue: 'Reset' })}
                </Button>
            </div>
          </ReflectionContainer>
          <ShortcutActiveRegion id="contacts-shortcut-region" className="outline-none">
            <DataTable
              key={`${currentPage}-${pageSize}`}
              id="contacts-table"
              data={tableData}
              columns={columns}
              pagination={true}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              pageSize={pageSize}
              onItemsPerPageChange={handlePageSizeChange}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
              manualSorting={true}
            />
          </ShortcutActiveRegion>
          <div className="app-print-root app-print-only">
            <PrintableTable
              title={t('contactsPage.print.title', { defaultValue: 'Contacts' })}
              subtitle={t('contactsPage.print.subtitle', {
                count: filteredContacts.length,
                defaultValue: '{{count}} contacts',
              })}
              rows={filteredContacts}
              columns={selectedContactPrintColumns}
              getRowKey={(contact) => contact.contact_name_id}
              emptyMessage={t('contactsPage.print.noContacts', { defaultValue: 'No contacts to print' })}
            />
          </div>
          <PrintOptionsDialog
            id="contacts-print-options-dialog"
            open={isPrintOptionsOpen}
            onOpenChange={setIsPrintOptionsOpen}
            title={t('contactsPage.print.optionsDialog.title', { defaultValue: 'Print options' })}
            description={t('contactsPage.print.optionsDialog.description', {
              defaultValue: 'Choose which columns to include when printing contacts.',
            })}
            columns={printColumns}
            selectedColumnKeys={selectedContactPrintColumnKeys}
            onSelectedColumnKeysChange={setSelectedContactPrintColumnKeys}
            onReset={resetSelectedContactPrintColumnKeys}
            onPrint={() => triggerPrintContacts()}
            isPrinting={isPreparingContactPrint}
          />
        </div>
        <QuickAddContact
          isOpen={isQuickAddOpen}
          onClose={() => setIsQuickAddOpen(false)}
          onContactAdded={handleContactAdded}
          clients={clients}
          selectedClientId={preSelectedClientId}
        />

        <ContactsImportDialog
          isOpen={isImportDialogOpen}
          onClose={() => setIsImportDialogOpen(false)}
          onImportComplete={handleImportComplete}
          clients={clients}
        />

        {/* ConfirmationDialog for Delete */}
        <DeleteEntityDialog
          id="delete-contact-dialog"
          isOpen={isDeleteDialogOpen}
          onClose={resetDeleteState}
          onConfirmDelete={confirmDelete}
          onAlternativeAction={handleDeleteAlternativeAction}
          entityName={
            contactToDelete?.full_name
            || t('contactsPage.thisContact', { defaultValue: 'this contact' })
          }
          validationResult={deleteValidation}
          isValidating={isDeleteValidating}
          isDeleting={isDeleteProcessing}
        />

        <ConfirmationDialog
          id="last-usage-phone-types-dialog"
          isOpen={lastUsagePhoneTypes.length > 0}
          onClose={handleKeepPhoneTypes}
          onConfirm={handleConfirmDeletePhoneTypes}
          onCancel={handleKeepPhoneTypes}
          title={t('contactsPage.lastPhoneTypeUsage.title', {
            defaultValue: 'Last Phone Type Usage'
          })}
          message={t('contactsPage.lastPhoneTypeUsage.message', {
            defaultValue:
              'The following custom phone types are no longer used by any contact: {{labels}}. Delete the type definitions, or keep them for future use?',
            count: lastUsagePhoneTypes.length,
            labels: lastUsagePhoneTypes.map(type => `"${type.label}"`).join(', ')
          })}
          confirmLabel={t('contactsPage.lastPhoneTypeUsage.deleteType', {
            defaultValue: 'Delete Type'
          })}
          thirdButtonLabel={t('contactsPage.lastPhoneTypeUsage.keepType', {
            defaultValue: 'Keep Type'
          })}
          cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        />
      </div>
  );
};

export default Contacts;
