'use client'

import { useEffect, useState } from 'react';
import ContactDetailsView from 'server/src/components/contacts/ContactDetailsView';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { getDocumentsByEntity } from 'server/src/lib/actions/document-actions/documentActions';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getContactByContactNameId } from 'server/src/lib/actions/contact-actions/contactActions';
import { getAllCompanies } from 'server/src/lib/actions/companyActions';

const ContactDetailPage = ({ params }: { params: { id: string } }) => {
  const [contact, setContact] = useState<IContact | null>(null);
  const [documents, setDocuments] = useState<IDocument[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch user data first
        const userData = await getCurrentUser();
        setCurrentUser(userData);

        // Fetch companies using server action
        const companiesData = await getAllCompanies();
        setCompanies(companiesData);

        // Fetch contact data using server action
        const contactData = await getContactByContactNameId(params.id);
        setContact(contactData);

        // Fetch documents using server action
        const documentsData = await getDocumentsByEntity(params.id, 'contact');
        setDocuments(documentsData);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchData();
  }, [params.id]);

  if (!contact || !currentUser) {
    return <div>Loading...</div>;
  }

  const handleDocumentCreated = async () => {
    // Refresh documents after a new one is created
    const updatedDocuments = await getDocumentsByEntity(params.id, 'contact');
    setDocuments(updatedDocuments);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">{contact.full_name}</h1>
      <ContactDetailsView 
        initialContact={contact} 
        companies={companies} 
        documents={documents}
        userId={currentUser.user_id}
        onDocumentCreated={handleDocumentCreated}
      />
    </div>
  );
};

export default ContactDetailPage;
