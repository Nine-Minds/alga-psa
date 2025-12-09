'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getAllContacts, getContactsByClient, getAllClients, exportContactsToCSV, deleteContact, archiveContact, reactivateContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { findTagsByEntityIds, findAllTagsByType } from 'server/src/lib/actions/tagActions';
import { Button } from 'server/src/components/ui/Button';
import { SearchInput } from 'server/src/components/ui/SearchInput';
import { Pen, Eye, CloudDownload, MoreVertical, Upload, Trash2, XCircle, ExternalLink, Power, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import QuickAddContact from './QuickAddContact';
import { useDrawer } from "server/src/context/DrawerContext";
import ContactDetails from './ContactDetails';
import ContactDetailsEdit from './ContactDetailsEdit';
import ContactsImportDialog from './ContactsImportDialog';
import ClientDetails from '../clients/ClientDetails';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { TagManager, TagFilter } from 'server/src/components/tags';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import { getUniqueTagTexts } from 'server/src/utils/colorUtils';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getDocumentsByEntity } from 'server/src/lib/actions/document-actions/documentActions';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
import { useRouter } from 'next/navigation';
import ContactsSkeleton from './ContactsSkeleton';
import { useUserPreference } from 'server/src/hooks/useUserPreference';

const CONTACTS_PAGE_SIZE_SETTING = 'contacts_page_size';

interface ContactsProps {
  initialContacts: IContact[];
  clientId?: string;
  preSelectedClientId?: string;
}

const Contacts: React.FC<ContactsProps> = ({ initialContacts, clientId, preSelectedClientId }) => {
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['contact']);

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
  const [clients, setClients] = useState<IClient[]>([]);
  const [documents, setDocuments] = useState<Record<string, IDocument[]>>({});
  const [documentLoading, setDocumentLoading] = useState<Record<string, boolean>>({});
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isFiltered, setIsFiltered] = useState(false);
  const [sortBy, setSortBy] = useState<string>('full_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const contactTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<IContact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeactivateOption, setShowDeactivateOption] = useState(false);
  const [deleteDependencies, setDeleteDependencies] = useState<{
    tickets?: number;
    interactions?: number;
    documents?: number;
    projects?: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [changesSavedInDrawer, setChangesSavedInDrawer] = useState(false);

  const statusOptions = [
    { value: 'all', label: 'All contacts' },
    { value: 'active', label: 'Active contacts' },
    { value: 'inactive', label: 'Inactive contacts' }
  ];

  const refreshContacts = async () => {
    // Force refresh by changing a key to trigger re-render
    setRefreshKey(prev => prev + 1);
  };

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
            getCurrentUser()
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

        const newContactTags: Record<string, ITag[]> = {};
        contactTags.forEach(tag => {
          if (!newContactTags[tag.tagged_id]) {
            newContactTags[tag.tagged_id] = [];
          }
          newContactTags[tag.tagged_id].push(tag);
        });

        contactTagsRef.current = newContactTags;
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
        setAllUniqueTags(allTags);
      } catch (error) {
        console.error('Error fetching all tags:', error);
      }
    };
    fetchAllTags();
  }, []);

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

  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.client_id === clientId);
    return client ? client.client_name : 'Unknown Client';
  };

  const handleContactAdded = (newContact: IContact) => {
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
          
          setDocuments(prev => {
            const newDocuments = { ...prev };
            newDocuments[contact.contact_name_id] = Array.isArray(response)
              ? response
              : response.documents || [];
            return newDocuments;
          });
        }

        openDrawer(
          <ContactDetails
            contact={contact}
            clients={clients}
            documents={documents[contact.contact_name_id] || []}
            userId={currentUser}
            isInDrawer={true}
            quickView={true}
            onDocumentCreated={async () => {
              try {
                const updatedResponse = await getDocumentsByEntity(contact.contact_name_id, 'contact');
                
                setDocuments(prev => {
                  const newDocuments = { ...prev };
                  newDocuments[contact.contact_name_id] = Array.isArray(updatedResponse)
                    ? updatedResponse
                    : updatedResponse.documents || [];
                  return newDocuments;
                });
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
          
          setDocuments(prev => {
            const newDocuments = { ...prev };
            newDocuments[contact.contact_name_id] = Array.isArray(response)
              ? response
              : response.documents || [];
            return newDocuments;
          });
        }

        openDrawer(
          <ContactDetails
            contact={contact}
            clients={clients}
            documents={documents[contact.contact_name_id] || []}
            userId={currentUser}
            isInDrawer={true}
            quickView={true}
            onDocumentCreated={async () => {
              try {
                const updatedResponse = await getDocumentsByEntity(contact.contact_name_id, 'contact');
                
                setDocuments(prev => {
                  const newDocuments = { ...prev };
                  newDocuments[contact.contact_name_id] = Array.isArray(updatedResponse)
                    ? updatedResponse
                    : updatedResponse.documents || [];
                  return newDocuments;
                });
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

  const handleDeleteContact = (contact: IContact) => {
    setContactToDelete(contact);
    setDeleteError(null);
    setShowDeactivateOption(false);
    setDeleteDependencies(null);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!contactToDelete) return;

    try {
      const result = await deleteContact(contactToDelete.contact_name_id);

      if (result.success) {
        setContacts(prevContacts =>
          prevContacts.filter(c => c.contact_name_id !== contactToDelete.contact_name_id)
        );

        setIsDeleteDialogOpen(false);
        setContactToDelete(null);
        setDeleteError(null);
        setShowDeactivateOption(false);
        setDeleteDependencies(null);
        toast.success(`${contactToDelete.full_name} has been deleted successfully.`);
      } else {
        // Handle dependency errors - show structured display
        // Only include counts that are > 0
        if (result.code === 'CONTACT_HAS_DEPENDENCIES' && result.counts) {
          const counts = result.counts as Record<string, number>;
          setDeleteDependencies({
            tickets: counts['ticket'] > 0 ? counts['ticket'] : undefined,
            interactions: counts['interaction'] > 0 ? counts['interaction'] : undefined,
            documents: counts['document'] > 0 ? counts['document'] : undefined,
            projects: counts['project'] > 0 ? counts['project'] : undefined,
          });
          setShowDeactivateOption(true);
        } else {
          setDeleteError(result.message || 'Failed to delete contact. Please try again.');
        }
        return;
      }
    } catch (err) {
      console.error('Error deleting contact:', err);
      if (err instanceof Error) {
        setDeleteError(err.message || 'Failed to delete contact. Please try again.');
      } else {
        setDeleteError('Failed to delete contact. Please try again.');
      }
    }
  };

  const handleMarkContactInactive = async () => {
    if (!contactToDelete) return;

    try {
      const result = await archiveContact(contactToDelete.contact_name_id);

      if (!result.success) {
        toast.error(result.message || 'Failed to mark contact as inactive');
        setIsDeleteDialogOpen(false);
        setContactToDelete(null);
        setShowDeactivateOption(false);
        setDeleteDependencies(null);
        return;
      }

      // Update contact in the list to reflect inactive status
      setContacts(prevContacts =>
        prevContacts.map(c =>
          c.contact_name_id === contactToDelete.contact_name_id
            ? { ...c, is_inactive: true }
            : c
        )
      );

      setIsDeleteDialogOpen(false);
      setContactToDelete(null);
      setShowDeactivateOption(false);
      setDeleteDependencies(null);
      toast.success(`${contactToDelete.full_name} has been marked as inactive successfully.`);
    } catch (error) {
      console.error('Error marking contact as inactive:', error);
      setDeleteError('An error occurred while marking the contact as inactive. Please try again.');
    }
  };

  const resetDeleteState = () => {
    setIsDeleteDialogOpen(false);
    setContactToDelete(null);
    setDeleteError(null);
    setShowDeactivateOption(false);
    setDeleteDependencies(null);
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
      title: 'Name',
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
      title: 'Created',
      dataIndex: 'created_at',
      width: '12%',
      render: (value, record): React.ReactNode => {
        if (!record.created_at) return 'N/A';
        const date = new Date(record.created_at);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      },
    },
    {
      title: 'Email',
      dataIndex: 'email',
      width: '18%',
      render: (value, record): React.ReactNode => record.email || 'N/A',
    },
    {
      title: 'Phone Number',
      dataIndex: 'phone_number',
      width: '15%',
      render: (value, record): React.ReactNode => record.phone_number || 'N/A',
    },
    {
      title: 'Client',
      dataIndex: 'client_id',
      width: '13%',
      render: (value, record): React.ReactNode => {
        const clientId = record.client_id;
        if (typeof clientId !== 'string' || !clientId) {
          return <span className="text-gray-500">No Client</span>;
        }

        const client = clients.find(c => c.client_id === clientId);
        if (!client) {
          return <span className="text-gray-500">{getClientName(clientId)}</span>;
        }

        return (
          <div
            role="button"
            tabIndex={0}
            onClick={() => openDrawer(
              <ClientDetails
                client={client}
                documents={[]}
                contacts={[]}
                isInDrawer={true}
                quickView={true}
              />
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDrawer(
                  <ClientDetails
                    client={client}
                    documents={[]}
                    contacts={[]}
                    isInDrawer={true}
                    quickView={true}
                  />
                );
              }
            }}
            className="text-blue-600 hover:underline cursor-pointer"
          >
            {client.client_name}
          </div>
        );
      },
    },
    {
      title: 'Tags',
      dataIndex: 'tags',
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
      title: 'Actions',
      dataIndex: 'actions',
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
              <span className="sr-only">Open menu</span>
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
              Quick View
            </DropdownMenu.Item>
            <DropdownMenu.Item 
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center rounded"
              onSelect={() => handleEditContact(record)}
            >
              <Pen size={14} className="mr-2" />
              Edit
            </DropdownMenu.Item>
            <DropdownMenu.Item 
              className="px-2 py-1 text-sm cursor-pointer hover:bg-red-100 text-red-600 flex items-center rounded"
              onSelect={() => handleDeleteContact(record)}
            >
              <Trash2 size={14} className="mr-2" />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      ),
    },
  ];

  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      const searchTermLower = searchTerm.toLowerCase();
      const matchesSearch = contact.full_name.toLowerCase().includes(searchTermLower) || 
                          (contact.email && contact.email.toLowerCase().includes(searchTermLower));
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
  }, [contacts, searchTerm, filterStatus, selectedTags]);

  // Memoize the data transformation for DataTable
  const tableData = useMemo(() => filteredContacts.map((contact) => ({
    ...contact,
    id: contact.contact_name_id
  })), [filteredContacts]);

  if (isLoading) {
    return <ContactsSkeleton />;
  }

  return (
    <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Contacts</h1>
          <div className="flex items-center gap-2">
            <Button
              id="new-contact-dialog-button"
              onClick={() => setIsQuickAddOpen(true)}
            >
              + Add Contact
            </Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                  <button className="border border-gray-300 rounded-md p-2 flex items-center gap-2">
                    <MoreVertical size={16} />
                    Actions
                  </button>
              </DropdownMenu.Trigger>
                <DropdownMenu.Content className="bg-white rounded-md shadow-lg p-1">
                  <DropdownMenu.Item 
                    className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
                    onSelect={() => setIsImportDialogOpen(true)}
                  >
                    <Upload size={14} className="mr-2" />
                    Upload CSV
                  </DropdownMenu.Item>
                  <DropdownMenu.Item 
                    className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
                    onSelect={() => void handleExportToCSV()}
                  >
                    <CloudDownload size={14} className="mr-2" />
                    Download CSV
                  </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <ReflectionContainer id='filters'>
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-4">
                <SearchInput
                  id='filter-contacts'
                  placeholder="Search contacts"
                  className="w-64"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setIsFiltered(e.target.value !== '' || selectedTags.length > 0 || filterStatus !== 'active');
                  }}
                />

                <TagFilter
                  allTags={allUniqueTags}
                  selectedTags={selectedTags}
                  onTagSelect={(tag) => {
                    setSelectedTags(prev => {
                      const newTags = prev.includes(tag)
                        ? prev.filter(t => t !== tag)
                        : [...prev, tag];
                      setIsFiltered(searchTerm !== '' || newTags.length > 0 || filterStatus !== 'active');
                      return newTags;
                    });
                  }}
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
                
                {isFiltered && (
                  <Button
                    id="reset-filters-button"
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap flex items-center gap-2 ml-auto"
                    onClick={() => {
                      setSearchTerm('');
                      setSelectedTags([]);
                      setFilterStatus('active');
                      setIsFiltered(false);
                    }}
                  >
                    <XCircle className="h-4 w-4" />
                    Reset Filters
                  </Button>
                )}
              </div>
            </div>
          </ReflectionContainer>
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
        <ConfirmationDialog
          id="delete-contact-dialog"
          isOpen={isDeleteDialogOpen}
          onClose={resetDeleteState}
          onConfirm={showDeactivateOption ? handleMarkContactInactive : confirmDelete}
          title="Delete Contact"
          message={
            showDeactivateOption && deleteDependencies ? (
              <div className="space-y-4">
                <p className="text-gray-700">Unable to delete this contact.</p>
                <div>
                  <p className="text-gray-700 mb-2">This contact has the following associated records:</p>
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    {deleteDependencies.tickets && deleteDependencies.tickets > 0 && (
                      <li>{deleteDependencies.tickets} active ticket{deleteDependencies.tickets !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.interactions && deleteDependencies.interactions > 0 && (
                      <li>{deleteDependencies.interactions} interaction{deleteDependencies.interactions !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.documents && deleteDependencies.documents > 0 && (
                      <li>{deleteDependencies.documents} document{deleteDependencies.documents !== 1 ? 's' : ''}</li>
                    )}
                    {deleteDependencies.projects && deleteDependencies.projects > 0 && (
                      <li>{deleteDependencies.projects} active project{deleteDependencies.projects !== 1 ? 's' : ''}</li>
                    )}
                  </ul>
                </div>
                <p className="text-gray-700">Please remove or reassign these items before deleting the contact.</p>
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                  <p className="text-blue-800">
                    <span className="font-semibold">Alternative Option:</span> You can mark this contact as inactive instead. Inactive contacts are hidden from most views but retain all their data and can be marked as active later.
                  </p>
                </div>
              </div>
            ) : deleteError ? deleteError : "Are you sure you want to delete this contact? This action cannot be undone."
          }
          confirmLabel={showDeactivateOption ? "Mark as Inactive" : "Delete"}
          cancelLabel="Cancel"
          isConfirming={false}
        />
      </div>
  );
};

export default Contacts;
