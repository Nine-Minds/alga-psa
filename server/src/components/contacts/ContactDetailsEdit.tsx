'use client'

import React, { useState, useEffect } from 'react';
import { IContact } from '@/interfaces/contact.interfaces';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { updateContact } from '@/lib/actions/contact-actions/contactActions';
import { findTagsByEntityIds, findAllTagsByType } from '@/lib/actions/tagActions';
import { ITag } from '@/interfaces/tag.interfaces';
import { CompanyPicker } from '../companies/CompanyPicker';
import { ICompany } from '@/interfaces/company.interfaces';
import { TagManager } from '@/components/tags';
import { ArrowLeft } from 'lucide-react';

interface ContactDetailsEditProps {
  initialContact: IContact;
  companies: ICompany[];
  onSave: (contact: IContact) => void;
  onCancel: () => void;
  isInDrawer?: boolean;
}

const ContactDetailsEdit: React.FC<ContactDetailsEditProps> = ({
  initialContact,
  companies,
  onSave,
  onCancel,
  isInDrawer = false
}) => {
  const [contact, setContact] = useState<IContact>(initialContact);
  const [tags, setTags] = useState<ITag[]>([]);
  const [allTagTexts, setAllTagTexts] = useState<string[]>([]);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

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

  const handleInputChange = (field: keyof IContact, value: string | boolean) => {
    setContact(prev => ({ ...prev, [field]: value }));
  };

  const handleCompanySelect = (companyId: string) => {
    setContact(prev => ({ ...prev, company_id: companyId }));
  };

  const handleSave = async () => {
    try {
      const updatedContact = await updateContact(contact);
      onSave(updatedContact);
    } catch (error) {
      console.error('Error updating contact:', error);
    }
  };

  const handleTagsChange = (updatedTags: ITag[]) => {
    setTags(updatedTags);
  };

  return (
    <div className="p-6 bg-white shadow rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <Heading size="6">Edit Contact: {contact.full_name}</Heading>
      </div>
      <table className="min-w-full">
        <tbody>
          <TableRow 
            label="Full Name" 
            value={contact.full_name} 
            onChange={(value) => handleInputChange('full_name', value)} 
          />
          <TableRow 
            label="Email" 
            value={contact.email} 
            onChange={(value) => handleInputChange('email', value)} 
          />
          <TableRow 
            label="Phone" 
            value={contact.phone_number} 
            onChange={(value) => handleInputChange('phone_number', value)} 
          />
          <TableRow 
            label="Role" 
            value={contact.role || ''} 
            onChange={(value) => handleInputChange('role', value)} 
            placeholder="e.g., Manager, Developer, etc."
          />
          <tr>
            <td className="py-2 font-semibold">Company:</td>
            <td className="py-2">
              <CompanyPicker
                companies={companies}
                onSelect={handleCompanySelect}
                selectedCompanyId={contact.company_id}
                filterState={filterState}
                onFilterStateChange={setFilterState}
                clientTypeFilter={clientTypeFilter}
                onClientTypeFilterChange={setClientTypeFilter}
              />
            </td>
          </tr>
          <TableRow 
            label="Date of Birth" 
            value={contact.date_of_birth || ''} 
            onChange={(value) => handleInputChange('date_of_birth', value)} 
            type="date"
          />
          <TableRow 
            label="Status" 
            value={contact.is_inactive ? 'Inactive' : 'Active'} 
            onChange={(value) => handleInputChange('is_inactive', value === 'Inactive')} 
            options={['Active', 'Inactive']}
          />
          <tr>
            <td className="py-2 font-semibold">Notes:</td>
            <td className="py-2">
              <TextArea
                value={contact.notes || ''}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                placeholder="Add any additional notes about the contact..."
              />
            </td>
          </tr>
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
      <div className="mt-6 flex justify-end space-x-4">
        <Button variant="soft" onClick={onCancel}>Cancel</Button>
        <Button variant="default" onClick={handleSave}>Save</Button>
      </div>
    </div>
  );
};

interface TableRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  options?: string[];
  placeholder?: string;
}

const TableRow: React.FC<TableRowProps> = ({ label, value, onChange, type = "text", options, placeholder }) => (
  <tr>
    <td className="py-2 font-semibold">{label}:</td>
    <td className="py-2">
      {options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {options.map((option):JSX.Element => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full"
          placeholder={placeholder}
        />
      )}
    </td>
  </tr>
);

export default ContactDetailsEdit;
