'use client';

import React, { useState, useEffect } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { getContactsByCompany } from 'server/src/lib/actions/contact-actions/contactActions';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Eye, ExternalLink, MoreVertical } from 'lucide-react';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
import { useDrawer } from "server/src/context/DrawerContext";
import ContactDetailsView from './ContactDetailsView';
import ContactDetailsEdit from './ContactDetailsEdit';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getDocumentsByEntity } from 'server/src/lib/actions/document-actions/documentActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import QuickAddContact from 'server/src/components/contacts/QuickAddContact';

interface CompanyContactsListProps {
  companyId: string;
  companies: ICompany[]; // Pass companies down for ContactDetailsView
}

const CompanyContactsList: React.FC<CompanyContactsListProps> = ({ companyId, companies }) => {
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [documentLoading, setDocumentLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Record<string, IDocument[]>>({});
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);
  const { openDrawer } = useDrawer();

  useEffect(() => {
    const fetchContacts = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetchedContacts = await getContactsByCompany(companyId, 'active'); // Default to active
        setContacts(fetchedContacts);
      } catch (err) {
        console.error('Error fetching company contacts:', err);
        setError('Failed to load contacts.');
      } finally {
        setLoading(false);
      }
    };
    
    const fetchUser = async () => {
      try {
        const user = await getCurrentUser();
        if (user?.user_id) {
          setCurrentUser(user.user_id);
        }
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };

    fetchContacts();
    fetchUser();
  }, [companyId]);

  const handleViewDetails = async (contact: IContact) => {
    if (!currentUser) return;

    try {
      // Set loading state for this specific contact
      setDocumentLoading(prev => ({
        ...prev,
        [contact.contact_name_id]: true
      }));

      // Check if we already have documents for this contact
      const existingDocuments = documents[contact.contact_name_id];
      
      // Only fetch documents if we don't have them already
      if (!existingDocuments || existingDocuments.length === 0) {
        // Fetch documents for this contact
        const response = await getDocumentsByEntity(contact.contact_name_id, 'contact');
        
        // Update documents state with the fetched documents
        setDocuments(prev => {
          const newDocuments = { ...prev };
          // Handle both array and paginated response formats
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
            // Refresh documents after a new one is created
            try {
              setDocumentLoading(prev => ({
                ...prev,
                [contact.contact_name_id]: true
              }));
              
              const updatedResponse = await getDocumentsByEntity(contact.contact_name_id, 'contact');
              
              // Update documents state with the refreshed documents
              setDocuments(prev => {
                const newDocuments = { ...prev };
                // Handle both array and paginated response formats
                newDocuments[contact.contact_name_id] = Array.isArray(updatedResponse)
                  ? updatedResponse
                  : updatedResponse.documents || [];
                return newDocuments;
              });
            } catch (err) {
              console.error('Error refreshing documents:', err);
            } finally {
              setDocumentLoading(prev => ({
                ...prev,
                [contact.contact_name_id]: false
              }));
            }
          }}
        />
      );
    } catch (error) {
      console.error('Error fetching contact documents:', error);
    } finally {
      // Clear loading state
      setDocumentLoading(prev => ({
        ...prev,
        [contact.contact_name_id]: false
      }));
    }
  };

  const handleEditContact = (contact: IContact) => {
    if (!currentUser) return;

    openDrawer(
      <ContactDetailsEdit
        initialContact={contact}
        companies={companies}
        isInDrawer={true}
        onSave={(updatedContact) => {
          setContacts(prev =>
            prev.map(c =>
              c.contact_name_id === updatedContact.contact_name_id ? updatedContact : c
            )
          );

          setTimeout(() => handleViewDetails(updatedContact), 0);
        }}
        onCancel={() => handleViewDetails(contact)}
      />
    );
  };


  const columns: ColumnDefinition<IContact>[] = [
    {
      title: 'Name',
      dataIndex: 'full_name',
      width: '40%',
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
      width: '30%',
      render: (value, record): React.ReactNode => record.email || 'N/A',
    },
    {
      title: 'Phone Number',
      dataIndex: 'phone_number',
      width: '30%',
      render: (value, record): React.ReactNode => record.phone_number || 'N/A',
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '5%',
      render: (value, record): React.ReactNode => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              variant="ghost"
              id="company-contacts-actions-menu"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
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
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="animate-pulse flex flex-col space-y-4 w-full">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-12 bg-gray-200 rounded w-full"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 rounded w-full"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 rounded-md text-red-600">
        <p className="font-semibold">Error loading contacts</p>
        <p>{error}</p>
        <button
          onClick={() => {
            setLoading(true);
            setError(null);
            getContactsByCompany(companyId, 'active')
              .then(setContacts)
              .catch(err => {
                console.error('Error retrying contact fetch:', err);
                setError('Failed to load contacts. Please try again.');
              })
              .finally(() => setLoading(false));
          }}
          className="mt-2 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-md"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button 
          id="add-new-contact-btn"
          onClick={() => setIsQuickAddContactOpen(true)}
        >
          Add New Contact
        </Button>
      </div>
      <DataTable
        data={contacts}
        columns={columns}
        pagination={true}
        onRowClick={(row: IContact) => handleViewDetails(row)}
      />
      <QuickAddContact
        isOpen={isQuickAddContactOpen}
        onClose={() => setIsQuickAddContactOpen(false)}
        onContactAdded={() => {
          getContactsByCompany(companyId, 'active').then(setContacts);
        }}
        companies={companies}
        selectedCompanyId={companyId}
      />
    </div>
  );
};

export default CompanyContactsList;
