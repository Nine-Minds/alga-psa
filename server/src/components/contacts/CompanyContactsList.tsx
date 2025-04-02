'use client';

import React, { useState, useEffect } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { getContactsByCompany } from 'server/src/lib/actions/contact-actions/contactActions';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { getAvatarUrl } from 'server/src/utils/colorUtils';
import { useDrawer } from "server/src/context/DrawerContext";
import ContactDetailsView from './ContactDetailsView'; // Keep this for viewing details
import { ICompany } from 'server/src/interfaces/company.interfaces'; // Needed for ContactDetailsView
import { IDocument } from 'server/src/interfaces/document.interface'; // Needed for ContactDetailsView
import { getDocumentsByEntity } from 'server/src/lib/actions/document-actions/documentActions'; // Needed for ContactDetailsView
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions'; // Needed for ContactDetailsView

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
    <div>
      <DataTable
        data={contacts}
        columns={columns}
        pagination={true} // Enable pagination if needed
        onRowClick={(row: IContact) => handleViewDetails(row)}
      />
    </div>
  );
};

export default CompanyContactsList;