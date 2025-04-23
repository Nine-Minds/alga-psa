'use client';

import React, { useState, useEffect } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { getContactsByCompany } from 'server/src/lib/actions/contact-actions/contactActions';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
import { useDrawer } from "server/src/context/DrawerContext";
import ContactDetailsView from './ContactDetailsView';
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
      // Fetch documents for this contact
      const contactDocuments = await getDocumentsByEntity(contact.contact_name_id, 'contact');
      setDocuments(prev => ({
        ...prev,
        [contact.contact_name_id]: contactDocuments
      }));

      openDrawer(
        <ContactDetailsView
          initialContact={contact}
          companies={companies} // Pass companies list
          documents={documents[contact.contact_name_id] || []}
          userId={currentUser}
          isInDrawer={true} // Assuming this is always in a drawer context here
          // Add onDocumentCreated if needed, potentially passed down or handled differently
        />
      );
    } catch (error) {
      console.error('Error fetching contact documents:', error);
    }
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
  ];

  if (loading) {
    return <div>Loading contacts...</div>;
  }

  if (error) {
    return <div className="text-red-600">{error}</div>;
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
