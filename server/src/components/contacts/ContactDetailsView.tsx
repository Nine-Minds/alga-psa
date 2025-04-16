'use client'

import React, { useState, useEffect, useMemo } from 'react';
import { IContact } from '../../interfaces/contact.interfaces';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { QuickAddInteraction } from '../interactions/QuickAddInteraction';
import { Button } from '../ui/Button';
import { Pen, Plus, ArrowLeft } from 'lucide-react';
import { useDrawer } from '../../context/DrawerContext';
import ContactDetailsEdit from './ContactDetailsEdit';
import { findTagsByEntityIds, findAllTagsByType } from '../../lib/actions/tagActions';
import { ITag } from '../../interfaces/tag.interfaces';
import { ICompany } from '../../interfaces/company.interfaces';
import CompanyDetails from '../companies/CompanyDetails';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from '../../interfaces/interaction.interfaces';
import { TagList } from '../tags';
import { getCompanyById } from '../../lib/actions/companyActions';
import Documents from '../documents/Documents';
import { IDocument } from '../../interfaces/document.interface';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ButtonComponent, ContainerComponent } from '../../types/ui-reflection/types';
import ContactAvatarUpload from '../client-portal/contacts/ContactAvatarUpload';
import { getContactAvatarUrl } from '../../lib/utils/avatarUtils';

interface ContactDetailsViewProps {
  id?: string; // Made optional to maintain backward compatibility
  initialContact: IContact;
  companies: ICompany[];
  isInDrawer?: boolean;
  userId?: string;
  documents?: IDocument[];
  onDocumentCreated?: () => Promise<void>;
}

interface TableRowProps {
  label: string;
  value: string;
  onClick?: () => void;
}

const TableRow: React.FC<TableRowProps> = ({ label, value, onClick }) => (
  <tr>
    <td className="py-2 font-semibold">{label}:</td>
    <td className="py-2">
      {onClick ? (
        <button
          onClick={onClick}
          className="text-blue-600 hover:underline focus:outline-none"
        >
          {value}
        </button>
      ) : (
        value
      )}
    </td>
  </tr>
);

const ContactDetailsView: React.FC<ContactDetailsViewProps> = ({ 
  id = 'contact-details',
  initialContact, 
  companies,
  isInDrawer = false,
  userId,
  documents: initialDocuments = [],
  onDocumentCreated
}) => {
  const [contact, setContact] = useState<IContact>(initialContact);
  const [tags, setTags] = useState<ITag[]>([]);
  const [allTagTexts, setAllTagTexts] = useState<string[]>([]);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const [documents, setDocuments] = useState<IDocument[]>(initialDocuments);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const { openDrawer, goBack } = useDrawer();

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null);
        const [fetchedTags, allTags] = await Promise.all([
          findTagsByEntityIds([contact.contact_name_id], 'contact'),
          findAllTagsByType('contact')
        ]);
        
        setTags(fetchedTags);
        setAllTagTexts(allTags);
        
        // Fetch contact avatar URL
        if (userId && contact.tenant) {
          const contactAvatarUrl = await getContactAvatarUrl(contact.contact_name_id, contact.tenant);
          setAvatarUrl(contactAvatarUrl);
        }
      } catch (err) {
        console.error('Error fetching tags:', err);
        if (err instanceof Error) {
          if (err.message.includes('SYSTEM_ERROR:')) {
            setError('An unexpected error occurred while loading tags. Please try again or contact support.');
          } else {
            setError('Failed to load tags. Please try refreshing the page.');
          }
        } else {
          setError('An unexpected error occurred. Please try again.');
        }
      }
    };
    fetchData();
  }, [contact.contact_name_id, contact.tenant, userId]);

  // Update documents when initialDocuments changes
  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  const formatDateForDisplay = (dateString: string | null | undefined): string => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const handleEditContact = () => {
    openDrawer(
      <ContactDetailsEdit
        id={`${id}-edit`}
        initialContact={contact}
        companies={companies}
        isInDrawer={true}
        onSave={(updatedContact) => {
          setContact(updatedContact);
          openDrawer(
            <ContactDetailsView 
              id={id}
              initialContact={updatedContact} 
              companies={companies}
              isInDrawer={true}
              userId={userId}
              documents={documents}
              onDocumentCreated={onDocumentCreated}
            />
          );
        }}
        onCancel={() => openDrawer(
          <ContactDetailsView 
            id={id}
            initialContact={contact} 
            companies={companies}
            isInDrawer={true}
            userId={userId}
            documents={documents}
            onDocumentCreated={onDocumentCreated}
          />
        )}
      />
    );
  };

  const handleTagsChange = (updatedTags: ITag[]) => {
    setTags(updatedTags);
  };

  const getCompanyName = (companyId: string) => {
    const company = companies.find(c => c.company_id === companyId);
    return company ? company.company_name : 'Unknown Company';
  };

  const handleCompanyClick = async () => {
    if (contact.company_id) {
      try {
        setError(null);
        const company = await getCompanyById(contact.company_id);
        if (company) {
          openDrawer(
            <CompanyDetails 
              id={`${id}-company-details`}
              company={company} 
              documents={[]} 
              contacts={[]} 
              isInDrawer={true}
            />
          );
        } else {
          setError('Company not found. The company may have been deleted.');
        }
      } catch (err) {
        console.error('Error fetching company details:', err);
        if (err instanceof Error) {
          if (err.message.includes('SYSTEM_ERROR:')) {
            setError('An unexpected error occurred while loading company details. Please try again or contact support.');
          } else if (err.message.includes('FOREIGN_KEY_ERROR:')) {
            setError('The company no longer exists in the system.');
          } else {
            setError('Failed to load company details. Please try again.');
          }
        } else {
          setError('An unexpected error occurred. Please try again.');
        }
      }
    }
  };

  const handleInteractionAdded = (newInteraction: IInteraction) => {
    setInteractions(prevInteractions => {
      const updatedInteractions = [newInteraction, ...prevInteractions];
      return updatedInteractions.filter((interaction, index, self) =>
        index === self.findIndex((t) => t.interaction_id === interaction.interaction_id)
      );
    });
  };
  
  return (
    <ReflectionContainer id={id} label={`Contact Details - ${contact.full_name}`}>
      <div className="p-6 bg-white shadow rounded-lg">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-800">{error}</p>
          </div>
        )}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <Heading size="6">{contact.full_name}</Heading>
            <div className="flex items-center space-x-2">
              <Button
                id={`${id}-back-button`}
                onClick={goBack}
                variant="ghost"
                size="sm"
                className="flex items-center"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                id={`${id}-edit-button`}
                variant="soft"
                size="sm"
                onClick={handleEditContact}
                className="flex items-center"
              >
                <Pen className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </div>
          </div>
          
          {/* Contact Avatar Upload */}
          {userId && (
            <div className="mb-4">
              <ContactAvatarUpload
                contactId={contact.contact_name_id}
                contactName={contact.full_name}
                avatarUrl={avatarUrl}
                userType="internal"
                onAvatarChange={(newAvatarUrl) => setAvatarUrl(newAvatarUrl)}
              />
            </div>
          )}
        </div>
        <table className="min-w-full">
          <tbody>
            <TableRow label="Full Name" value={contact.full_name} />
            <TableRow label="Email" value={contact.email} />
            <TableRow label="Phone" value={contact.phone_number} />
            <TableRow 
              label="Company" 
              value={getCompanyName(contact.company_id!)}
              onClick={handleCompanyClick}
            />
            <TableRow label="Role" value={contact.role || 'Not set'} />
            <TableRow label="Date of Birth" value={formatDateForDisplay(contact.date_of_birth)} />
            <TableRow label="Status" value={contact.is_inactive ? 'Inactive' : 'Active'} />
            <TableRow label="Created At" value={new Date(contact.created_at).toLocaleString()} />
            <TableRow label="Updated At" value={new Date(contact.updated_at).toLocaleString()} />
            {contact.notes && (
              <tr>
                <td className="py-2 font-semibold align-top">Notes:</td>
                <td className="py-2 whitespace-pre-wrap">{contact.notes}</td>
              </tr>
            )}
            <tr>
              <td className="py-2 font-semibold">Tags:</td>
              <td className="py-2">
                <TagList
                  id={`${id}-tags`}
                  tags={tags}
                  className="mt-1"
                />
              </td>
            </tr>
          </tbody>
        </table>

        {userId && (
          <div className="mt-6">
            <Heading size="4" className="mb-4">Documents</Heading>
            <Documents
              id={`${id}-documents`}
              documents={documents}
              userId={userId}
              entityId={contact.contact_name_id}
              entityType="contact"
              onDocumentCreated={onDocumentCreated}
              isInDrawer={isInDrawer}
            />
          </div>
        )}

        <div className="mt-6">
          <InteractionsFeed 
            id={`${id}-interactions`}
            entityId={contact.contact_name_id} 
            entityType="contact"
            companyId={contact.company_id!}
            interactions={interactions}
            setInteractions={setInteractions}
          />
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default ContactDetailsView;
