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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [currentUser, setCurrentUser] = useState<IUserWithRoles | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
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
        const documentsResponse = await getDocumentsByEntity(params.id, 'contact');
        // Handle both array and paginated response formats
        const documentsList = Array.isArray(documentsResponse)
          ? documentsResponse
          : documentsResponse.documents || [];
        setDocuments(documentsList);
      } catch (error) {
        console.error('Error fetching data:', error);
        setError('Failed to load contact data. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [params.id]);

  if (error) {
    return (
      <div className="p-6">
        <div className="p-4 border border-red-300 bg-red-50 rounded-md text-red-600">
          <p className="font-semibold">Error loading contact</p>
          <p>{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              // Retry fetching data
              const fetchData = async () => {
                try {
                  const userData = await getCurrentUser();
                  setCurrentUser(userData);
                  
                  const companiesData = await getAllCompanies();
                  setCompanies(companiesData);
                  
                  const contactData = await getContactByContactNameId(params.id);
                  setContact(contactData);
                  
                  const documentsResponse = await getDocumentsByEntity(params.id, 'contact');
                  const documentsList = Array.isArray(documentsResponse)
                    ? documentsResponse
                    : documentsResponse.documents || [];
                  setDocuments(documentsList);
                } catch (err) {
                  console.error('Error retrying data fetch:', err);
                  setError('Failed to load contact data. Please try again.');
                } finally {
                  setLoading(false);
                }
              };
              fetchData();
            }}
            className="mt-2 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-md"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!contact || !currentUser || loading) {
    return (
      <div className="p-6">
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

  const handleDocumentCreated = async () => {
    try {
      setLoading(true);
      // Refresh documents after a new one is created
      const updatedResponse = await getDocumentsByEntity(params.id, 'contact');
      // Handle both array and paginated response formats
      const updatedDocumentsList = Array.isArray(updatedResponse)
        ? updatedResponse
        : updatedResponse.documents || [];
      setDocuments(updatedDocumentsList);
    } catch (error) {
      console.error('Error refreshing documents:', error);
    } finally {
      setLoading(false);
    }
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
