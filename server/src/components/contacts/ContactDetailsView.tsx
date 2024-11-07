'use client'

import React, { useState, useEffect } from 'react';
import { IContact } from '@/interfaces/contact.interfaces';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { QuickAddInteraction } from '../interactions/QuickAddInteraction';
import { Button } from '@/components/ui/Button';
import { Pen, Plus, ArrowLeft } from 'lucide-react';
import { useDrawer } from '@/context/DrawerContext';
import ContactDetailsEdit from './ContactDetailsEdit';
import { findTagsByEntityIds, findAllTagsByType } from '@/lib/actions/tagActions';
import { ITag } from '@/interfaces/tag.interfaces';
import { ICompany } from '@/interfaces/company.interfaces';
import CompanyDetails from '../companies/CompanyDetails';
import InteractionsFeed from '../interactions/InteractionsFeed';
import { IInteraction } from '@/interfaces/interaction.interfaces';
import { TagManager } from '@/components/tags';
import { getCompanyById } from '@/lib/actions/companyActions';

interface ContactDetailsViewProps {
  initialContact: IContact;
  companies: ICompany[];
  isInDrawer?: boolean;
}

const ContactDetailsView: React.FC<ContactDetailsViewProps> = ({ 
  initialContact, 
  companies,
  isInDrawer = false
}) => {
  const [contact, setContact] = useState<IContact>(initialContact);
  const [tags, setTags] = useState<ITag[]>([]);
  const [allTagTexts, setAllTagTexts] = useState<string[]>([]);
  const [interactions, setInteractions] = useState<IInteraction[]>([]);
  const { openDrawer, goBack } = useDrawer();

  useEffect(() => {
    const fetchData = async () => {
      const [fetchedTags, allTags] = await Promise.all([
        findTagsByEntityIds([contact.contact_name_id], 'contact'),
        findAllTagsByType('contact')
      ]);
      
      setTags(fetchedTags);
      setAllTagTexts(allTags);
    };
    fetchData();
  }, [contact.contact_name_id]);

  const formatDateForDisplay = (dateString: string | null | undefined): string => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const handleEditContact = () => {
    openDrawer(
      <ContactDetailsEdit
        initialContact={contact}
        companies={companies}
        isInDrawer={true}
        onSave={(updatedContact) => {
          setContact(updatedContact);
          openDrawer(
            <ContactDetailsView 
              initialContact={updatedContact} 
              companies={companies}
              isInDrawer={true}
            />
          );
        }}
        onCancel={() => openDrawer(
          <ContactDetailsView 
            initialContact={contact} 
            companies={companies}
            isInDrawer={true}
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
        const company = await getCompanyById(contact.company_id);
        if (company) {
          openDrawer(
            <CompanyDetails 
              company={company} 
              documents={[]} 
              contacts={[]} 
              isInDrawer={true}
            />
          );
        } else {
          console.error('Company not found');
        }
      } catch (error) {
        console.error('Error fetching company details:', error);
      }
    } else {
      console.log('No company associated with this contact');
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
    <div className="p-6 bg-white shadow rounded-lg">
      <div className="flex justify-between items-center mb-6">
        <Heading size="6">{contact.full_name}</Heading>
        <div className="flex items-center space-x-2">
          <Button
            onClick={goBack}
            variant="ghost"
            size="sm"
            className="flex items-center"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button
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
      <table className="min-w-full">
        <tbody>
          <TableRow label="Full Name" value={contact.full_name} />
          <TableRow label="Email" value={contact.email} />
          <TableRow label="Phone" value={contact.phone_number} />
          <TableRow 
            label="Company" 
            value={getCompanyName(contact.company_id!)}
            onClick={() => handleCompanyClick()}
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
              <TagManager
                entityId={contact.contact_name_id}
                entityType="contact"
                initialTags={tags}
                existingTags={allTagTexts}
                onTagsChange={handleTagsChange}
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-6">
        <InteractionsFeed 
          entityId={contact.contact_name_id} 
          entityType="contact"
          companyId={contact.company_id!}
          interactions={interactions}
          setInteractions={setInteractions}
        />
      </div>
    </div>
  );
};

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

export default ContactDetailsView;
