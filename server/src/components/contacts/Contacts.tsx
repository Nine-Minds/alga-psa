'use client';

import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getAllContacts, getContactsByCompany, getAllCompanies, exportContactsToCSV, deleteContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { findTagsByEntityIds, createTag, deleteTag, findAllTagsByType } from 'server/src/lib/actions/tagActions';
import { Button } from 'server/src/components/ui/Button';
import { SearchInput } from 'server/src/components/ui/SearchInput';
import { Pen, Eye, CloudDownload, MoreVertical, Upload, Trash2 } from 'lucide-react';
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
import { getUniqueTagTexts, getAvatarUrl } from 'server/src/utils/colorUtils';
import GenericDialog from 'server/src/components/ui/GenericDialog';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getDocumentsByEntity } from 'server/src/lib/actions/document-actions/documentActions';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';

interface ContactsProps {
  initialContacts: IContact[];
  companyId?: string;
  preSelectedCompanyId?: string;
}

const Contacts: React.FC<ContactsProps> = ({ initialContacts, companyId, preSelectedCompanyId }) => {
  const [contacts, setContacts] = useState<IContact[]>(initialContacts);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [documents, setDocuments] = useState<Record<string, IDocument[]>>({});
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const { openDrawer } = useDrawer();
  const contactTagsRef = useRef<Record<string, ITag[]>>({});
  const [allUniqueTags, setAllUniqueTags] = useState<string[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<IContact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const statusOptions = [
    { value: 'all', label: 'All contacts' },
    { value: 'active', label: 'Active contacts' },
    { value: 'inactive', label: 'Inactive contacts' }
  ];

  // Fetch contacts and companies when filter status changes
  useEffect(() => {
    const fetchContactsAndCompanies = async () => {
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
      }
    };
    fetchContactsAndCompanies();
  }, [companyId, filterStatus]);

  // Fetch tags separately - no need to refetch when filter changes
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const [contactTags, allTags] = await Promise.all([
          findTagsByEntityIds(
            contacts.map((contact: IContact): string => contact.contact_name_id),
            'contact'
          ),
          findAllTagsByType('contact')
        ]);

        const newContactTags: Record<string, ITag[]> = {};
        contactTags.forEach(tag => {
          if (!newContactTags[tag.tagged_id]) {
            newContactTags[tag.tagged_id] = [];
          }
          newContactTags[tag.tagged_id].push(tag);
        });

        contactTagsRef.current = newContactTags;
        setAllUniqueTags(allTags);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    fetchTags();
  }, [contacts]); // Only re-fetch tags when contacts change

  const handleTagsChange = (contactId: string, updatedTags: ITag[]) => {
    contactTagsRef.current = {
      ...contactTagsRef.current,
      [contactId]: updatedTags,
    };
    setAllUniqueTags(getUniqueTagTexts(Object.values(contactTagsRef.current).flat()));
  };

  const getCompanyName = (companyId: string) => {
    const company = companies.find(c => c.company_id === companyId);
    return company ? company.company_name : 'Unknown Company';
  };

  const handleContactAdded = (newContact: IContact) => {
    setContacts(prevContacts => [...prevContacts, newContact]);
  };

  const handleViewDetails = async (contact: IContact) => {
    if (!currentUser) return; // Don't proceed if we don't have a user ID

    try {
      // Fetch documents for this contact
      const contactDocuments = await getDocumentsByEntity(contact.contact_name_id, 'contact');
      setDocuments(prev => ({
        ...prev,
        [contact.contact_name_id]: contactDocuments
      }));

      openDrawer(
        <ContactDetailsView
          initialContact={contact}
          companies={companies}
          documents={documents[contact.contact_name_id] || []}
          userId={currentUser}
          onDocumentCreated={async () => {
            // Refresh documents after a new one is created
            const updatedDocuments = await getDocumentsByEntity(contact.contact_name_id, 'contact');
            setDocuments(prev => ({
              ...prev,
              [contact.contact_name_id]: updatedDocuments
            }));
          }}
        />
      );
    } catch (error) {
      console.error('Error fetching contact documents:', error);
    }
  };

  const handleEditContact = (contact: IContact) => {
    if (!currentUser) return; // Don't proceed if we don't have a user ID

    openDrawer(
      <ContactDetailsEdit
        initialContact={contact}
        companies={companies}
        onSave={(updatedContact) => {
          setContacts(prevContacts =>
            prevContacts.map((c): IContact =>
              c.contact_name_id === updatedContact.contact_name_id ? updatedContact : c
            )
          );
          handleViewDetails(updatedContact);
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
              `${message}\n\nTo maintain data integrity, you can edit the contact and set its status to inactive instead.`
            );
          } else {
            setDeleteError(message);
          }
        } else if (err.message.includes('SYSTEM_ERROR:')) {
          setDeleteError('An unexpected error occurred. Please try again or contact support.');
        } else {
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
          <img
            className="h-8 w-8 rounded-full mr-2"
            src={getAvatarUrl(record.full_name, record.contact_name_id, 32)}
            alt={`${record.full_name} avatar`}
            loading="lazy"
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
            existingTags={allUniqueTags}
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
            <div
              role="button"
              tabIndex={0}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 w-9 p-0"
            >
              <MoreVertical size={16} />
            </div>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="bg-white rounded-md shadow-lg p-1">
            <DropdownMenu.Item
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
              onSelect={() => handleViewDetails(record)}
            >
              <Eye size={14} className="mr-2" />
              View
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
              onSelect={() => handleEditContact(record)}
            >
              <Pen size={14} className="mr-2" />
              Edit
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center text-red-600"
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
      const matchesSearch = contact.full_name.toLowerCase().includes(searchTerm.toLowerCase());
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

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Contacts</h1>
          <Button
            id="new-contact-dialog-button"
            onClick={() => setIsQuickAddOpen(true)}
          >
            Add Contact
          </Button>
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
                  onChange={(e) => setSearchTerm(e.target.value)}
                />

                <TagFilter
                  allTags={allUniqueTags}
                  selectedTags={selectedTags}
                  onTagSelect={(tag) => {
                    setSelectedTags(prev =>
                      prev.includes(tag)
                        ? prev.filter(t => t !== tag)
                        : [...prev, tag]
                    );
                  }}
                />

                <CustomSelect
                  id='filter-status'
                  value={filterStatus}
                  onValueChange={(value) => setFilterStatus(value as 'all' | 'active' | 'inactive')}
                  options={statusOptions}
                  className="min-w-[180px]"
                />
              </div>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <div className="border border-gray-300 rounded-md p-2 flex items-center gap-2 hover:bg-gray-50 cursor-pointer">
                    <MoreVertical size={16} />
                    Actions
                  </div>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content className="bg-white rounded-md shadow-lg p-1">
                  <DropdownMenu.Item
                    className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
                    onSelect={handleExportToCSV}
                  >
                    <CloudDownload size={14} className="mr-2" />
                    Download CSV
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
                    onSelect={() => setIsImportDialogOpen(true)}
                  >
                    <Upload size={14} className="mr-2" />
                    Upload CSV
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
          </ReflectionContainer>
          <DataTable
            id="contacts-table"
            data={useMemo(() => filteredContacts.map((contact): typeof filteredContacts[number] & { id: string } => ({
              ...contact,
              id: contact.contact_name_id // Add id property for unique keys
            })), [filteredContacts])}
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

        {/* Delete Confirmation Dialog */}
        <GenericDialog
          id={`delete-contact-dialog`}
          isOpen={isDeleteDialogOpen}
          onClose={() => {
            setIsDeleteDialogOpen(false);
            setContactToDelete(null);
            setDeleteError(null);
          }}
          title="Delete Contact"
        >
          <div className="p-6">
            {deleteError ? (
              <>
                <p className="mb-4 text-red-600">{deleteError}</p>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setIsDeleteDialogOpen(false);
                      setContactToDelete(null);
                      setDeleteError(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-4">Are you sure you want to delete this contact? This action cannot be undone.</p>
                <div className="flex justify-end gap-4">
                  <button
                    onClick={() => {
                      setIsDeleteDialogOpen(false);
                      setContactToDelete(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDelete}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </GenericDialog>
      </div>
    </Suspense >
  );
};

export default Contacts;
