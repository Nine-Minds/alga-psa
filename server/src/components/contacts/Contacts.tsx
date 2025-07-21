'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getAllContacts, getContactsByCompany, getAllCompanies, exportContactsToCSV, deleteContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { findTagsByEntityIds, findAllTagsByType } from 'server/src/lib/actions/tagActions';
import { Button } from 'server/src/components/ui/Button';
import { SearchInput } from 'server/src/components/ui/SearchInput';
import { Pen, Eye, CloudDownload, MoreVertical, Upload, Trash2, XCircle, ExternalLink } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import QuickAddContact from './QuickAddContact';
import { useDrawer } from "server/src/context/DrawerContext";
import ContactDetailsView from './ContactDetailsView';
import ContactDetailsEdit from './ContactDetailsEdit';
import ContactsImportDialog from './ContactsImportDialog';
import CompanyDetails from '../companies/CompanyDetails';
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
interface ContactsProps {
  initialContacts: IContact[];
  companyId?: string;
  preSelectedCompanyId?: string;
}

const Contacts: React.FC<ContactsProps> = ({ initialContacts, companyId, preSelectedCompanyId }) => {
  // Pre-fetch tag permissions to prevent individual API calls
  useTagPermissions(['contact']);
  
  const [contacts, setContacts] = useState<IContact[]>(initialContacts);
  const [companies, setCompanies] = useState<ICompany[]>([]);
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
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const contactTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<ITag[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<IContact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const statusOptions = [
    { value: 'all', label: 'All contacts' },
    { value: 'active', label: 'Active contacts' },
    { value: 'inactive', label: 'Inactive contacts' }
  ];

  // Fetch contacts and companies when filter status changes
  useEffect(() => {
    const fetchContactsAndCompanies = async () => {
      setIsLoading(true);
      try {
        let fetchedContacts: IContact[] = [];

        // Fetch contacts based on filter status
        if (companyId) {
          if (filterStatus === 'all') {
            fetchedContacts = await getContactsByCompany(companyId, 'all');
          } else if (filterStatus === 'active') {
            fetchedContacts = await getContactsByCompany(companyId, 'active');
          } else { // 'inactive'
            fetchedContacts = await getContactsByCompany(companyId, 'inactive');
          }
        } else {
          if (filterStatus === 'all') {
            fetchedContacts = await getAllContacts('all');
          } else if (filterStatus === 'active') {
            fetchedContacts = await getAllContacts('active');
          } else { // 'inactive'
            fetchedContacts = await getAllContacts('inactive');
          }
        }

        // Fetch companies and user data
        const [allCompanies, userData] = await Promise.all([
          getAllCompanies(),
          getCurrentUser()
        ]);

        setContacts(fetchedContacts);
        setCompanies(allCompanies);
        if (userData?.user_id) {
          setCurrentUser(userData.user_id);
        }
      } catch (error) {
        console.error('Error fetching contacts and companies:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchContactsAndCompanies();
  }, [companyId, filterStatus]);

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

  const getCompanyName = (companyId: string) => {
    const company = companies.find(c => c.company_id === companyId);
    return company ? company.company_name : 'Unknown Company';
  };

  const handleContactAdded = (newContact: IContact) => {
    setContacts(prevContacts => [...prevContacts, newContact]);
  };

  const handleViewDetails = async (contact: IContact) => {
    // If this is being used within a company context (companyId prop exists),
    // maintain the drawer behavior. Otherwise, navigate to the new contact details page.
    if (companyId) {
      // Company context - keep existing drawer behavior
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
          <ContactDetailsView
            initialContact={contact}
            companies={companies}
            documents={documents[contact.contact_name_id] || []}
            userId={currentUser}
            isInDrawer={true}
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
          />
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
      // Main contacts list - navigate to new contact details page
      router.push(`/msp/contacts/${contact.contact_name_id}`);
    }
  };

  const handleEditContact = (contact: IContact) => {
    if (!currentUser) return; // Don't proceed if we don't have a user ID

    openDrawer(
      <ContactDetailsEdit
        initialContact={contact}
        companies={companies}
        isInDrawer={true}
        onSave={(updatedContact) => {
          // Update the contact in the list with the new data
          setContacts(prevContacts => {
            const updatedContacts = prevContacts.map((c): IContact =>
              c.contact_name_id === updatedContact.contact_name_id ? updatedContact : c
            );
            return updatedContacts;
          });
          
          // After updating the list, view the contact details
          setTimeout(() => handleViewDetails(updatedContact), 0);
        }}
        onCancel={() => handleViewDetails(contact)}
      />
    );
  };

  const handleDeleteContact = (contact: IContact) => {
    setContactToDelete(contact);
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!contactToDelete) return;

    try {
      await deleteContact(contactToDelete.contact_name_id);
      
      setContacts(prevContacts =>
        prevContacts.filter(c => c.contact_name_id !== contactToDelete.contact_name_id)
      );

      setIsDeleteDialogOpen(false);
      setContactToDelete(null);
      setDeleteError(null);
    } catch (err) {
      console.error('Error deleting contact:', err);
      if (err instanceof Error) {
        if (err.message.includes('VALIDATION_ERROR:')) {
          // For dependency errors
          const message = err.message.replace('VALIDATION_ERROR:', '').trim();
          if (message.includes('associated records:')) {
            setDeleteError(
              `Cannot delete contact\n${message}\n\nTo maintain data integrity, you can edit the contact and mark it as inactive instead.`
            );
          } else {
            setDeleteError(message);
          }
        } else if (err.message.includes('SYSTEM_ERROR:')) {
          setDeleteError(err.message.replace('SYSTEM_ERROR:', 'System error:'));
        } else {
          console.log('Unhandled delete error:', err.message);
          setDeleteError('An error occurred while deleting the contact. Please try again.');
        }
      } else {
        setDeleteError('An unexpected error occurred. Please try again.');
      }
    }
  };

  const handleExportToCSV = async () => {
    try {
      const csvData = await exportContactsToCSV(filteredContacts, companies, contactTagsRef.current);

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

  const columns: ColumnDefinition<IContact>[] = [
    {
      title: 'Name',
      dataIndex: 'full_name',
      width: '25%',
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
            onClick={() => handleViewDetails(record)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleViewDetails(record);
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
      title: 'Email',
      dataIndex: 'email',
      width: '20%',
      render: (value, record): React.ReactNode => record.email || 'N/A',
    },
    {
      title: 'Phone Number',
      dataIndex: 'phone_number',
      width: '20%',
      render: (value, record): React.ReactNode => record.phone_number || 'N/A',
    },
    {
      title: 'Company',
      dataIndex: 'company_id',
      width: '17%',
      render: (value, record): React.ReactNode => {
        const companyId = record.company_id;
        if (typeof companyId !== 'string' || !companyId) {
          return <span className="text-gray-500">No Company</span>;
        }

        const company = companies.find(c => c.company_id === companyId);
        if (!company) {
          return <span className="text-gray-500">{getCompanyName(companyId)}</span>;
        }

        return (
          <div
            role="button"
            tabIndex={0}
            onClick={() => openDrawer(
              <CompanyDetails
                company={company}
                documents={[]}
                contacts={[]}
                isInDrawer={true}
              />
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDrawer(
                  <CompanyDetails
                    company={company}
                    documents={[]}
                    contacts={[]}
                    isInDrawer={true}
                  />
                );
              }
            }}
            className="text-blue-600 hover:underline cursor-pointer"
          >
            {company.company_name}
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
              onSelect={() => handleViewDetails(record)}
            >
              <Eye size={14} className="mr-2" />
              View
            </DropdownMenu.Item>
            <DropdownMenu.Item 
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center rounded"
              onSelect={() => handleEditContact(record)}
            >
              <ExternalLink size={14} className="mr-2" />
              Quick Edit
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
            id="contacts-table"
            data={tableData}
            columns={columns}
            pagination={true}
            currentPage={currentPage}
            onPageChange={handlePageChange}
            pageSize={10}
          />
        </div>
        <QuickAddContact
          isOpen={isQuickAddOpen}
          onClose={() => setIsQuickAddOpen(false)}
          onContactAdded={handleContactAdded}
          companies={companies}
          selectedCompanyId={preSelectedCompanyId}
        />

        <ContactsImportDialog
          isOpen={isImportDialogOpen}
          onClose={() => setIsImportDialogOpen(false)}
          onImportComplete={handleImportComplete}
          companies={companies}
        />

        {/* ConfirmationDialog for Delete */}
        <ConfirmationDialog
          id="delete-contact-dialog"
          isOpen={isDeleteDialogOpen}
          onClose={() => {
            setIsDeleteDialogOpen(false);
            setContactToDelete(null);
            setDeleteError(null);
          }}
          onConfirm={confirmDelete}
          title="Delete Contact"
          message={
            deleteError
              ? deleteError
              : "Are you sure you want to delete this contact? This action cannot be undone."
          }
          confirmLabel={deleteError ? undefined : "Delete"}
          cancelLabel={deleteError ? "Close" : "Cancel"}
          isConfirming={false}
        />
      </div>
  );
};

export default Contacts;
