'use client'

import React, { useState, useEffect } from 'react';
import { IContact } from '../../interfaces/contact.interfaces';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { TextArea } from '../ui/TextArea';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { updateContact } from '../../lib/actions/contact-actions/contactActions';
import { findTagsByEntityIds } from '../../lib/actions/tagActions';
import { ITag } from '../../interfaces/tag.interfaces';
import { CompanyPicker } from '../companies/CompanyPicker';
import { ICompany } from '../../interfaces/company.interfaces';
import { TagManager } from '../tags';
import { useTags } from '../../context/TagContext';
import { ArrowLeft } from 'lucide-react';
import { Switch } from '../ui/Switch';
import CustomSelect from '../ui/CustomSelect';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ButtonComponent, FormFieldComponent } from '../../types/ui-reflection/types';
import ContactAvatarUpload from 'server/src/components/client-portal/contacts/ContactAvatarUpload';
import { getContactAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';

interface ContactDetailsEditProps {
  id?: string; // Made optional to maintain backward compatibility
  initialContact: IContact;
  companies: ICompany[];
  onSave: (contact: IContact) => void;
  onCancel: () => void;
  isInDrawer?: boolean;
}

const ContactDetailsEdit: React.FC<ContactDetailsEditProps> = ({
  id = 'contact-edit',
  initialContact,
  companies,
  onSave,
  onCancel,
  isInDrawer = false
}) => {
  const [contact, setContact] = useState<IContact>(initialContact);
  const [tags, setTags] = useState<ITag[]>([]);
  const { tags: allTags } = useTags();
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const fetchedTags = await findTagsByEntityIds([contact.contact_name_id], 'contact');
        setTags(fetchedTags);
        
        if (contact.tenant) {
          const contactAvatarUrl = await getContactAvatarUrlAction(contact.contact_name_id, contact.tenant);
          setAvatarUrl(contactAvatarUrl);
        }
      } catch (err) {
        console.error('Error fetching data:', err);
      }
    };
    fetchData();
  }, [contact.contact_name_id, contact.tenant]);

  const handleInputChange = (field: keyof IContact, value: string | boolean) => {
    setContact(prev => ({ ...prev, [field]: value }));
  };

  const handleCompanySelect = (companyId: string | null) => {
    setContact(prev => ({ ...prev, company_id: companyId || '' }));
  };

  const handleSave = async () => {
    try {
      setError(null);
      
      // Validate required fields
      if (!contact.full_name?.trim()) {
        setError('Full name is required');
        return;
      }
      if (!contact.email?.trim()) {
        setError('Email address is required');
        return;
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contact.email.trim())) {
        setError('Please enter a valid email address');
        return;
      }
      
      const updatedContact = await updateContact(contact);
      onSave(updatedContact);
    } catch (err) {
      console.error('Error updating contact:', err);
      if (err instanceof Error) {
        // Handle specific error types with more detailed messages
        if (err.message.includes('VALIDATION_ERROR:')) {
          setError(err.message.replace('VALIDATION_ERROR:', 'Please fix the following:'));
        } else if (err.message.includes('EMAIL_EXISTS:')) {
          setError('Email already exists: A contact with this email address already exists in the system');
        } else if (err.message.includes('FOREIGN_KEY_ERROR:')) {
          setError(err.message.replace('FOREIGN_KEY_ERROR:', 'Invalid reference:'));
        } else if (err.message.includes('SYSTEM_ERROR:')) {
          setError(err.message.replace('SYSTEM_ERROR:', 'System error:'));
        } else {
          console.log('Unhandled error:', err.message);
          setError('An error occurred while saving. Please try again.');
        }
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    }
  };

  const handleTagsChange = (updatedTags: ITag[]) => {
    setTags(updatedTags);
  };

  return (
    <ReflectionContainer id={id} label={`Edit Contact - ${contact.full_name}`}>
      <div className="p-6 bg-white shadow rounded-lg">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-800">{error}</p>
          </div>
        )}
        <div className="flex justify-between items-center mb-4">
          <Heading size="6">Edit Contact: {contact.full_name}</Heading>
        </div>
        
        {/* Contact Avatar Upload */}
        <div className="mb-6">
          <ContactAvatarUpload
            contactId={contact.contact_name_id}
            contactName={contact.full_name}
            avatarUrl={avatarUrl}
            userType="internal"
            onAvatarChange={(newAvatarUrl) => setAvatarUrl(newAvatarUrl)}
          />
        </div>
        <table className="min-w-full">
          <tbody>
            <TableRow 
              id={`${id}-full-name`}
              label="Full Name" 
              value={contact.full_name} 
              onChange={(value) => handleInputChange('full_name', value)} 
            />
            <TableRow 
              id={`${id}-email`}
              label="Email" 
              value={contact.email} 
              onChange={(value) => handleInputChange('email', value)} 
            />
            <TableRow 
              id={`${id}-phone`}
              label="Phone" 
              value={contact.phone_number} 
              onChange={(value) => handleInputChange('phone_number', value)} 
            />
            <TableRow 
              id={`${id}-role`}
              label="Role" 
              value={contact.role || ''} 
              onChange={(value) => handleInputChange('role', value)} 
              placeholder="e.g., Manager, Developer, etc."
            />
            <tr>
              <td className="py-2 font-semibold">Company:</td>
              <td className="py-2">
                <CompanyPicker
                  id={`${id}-company-picker`}
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
              id={`${id}-dob`}
              label="Date of Birth" 
              value={contact.date_of_birth || ''} 
              onChange={(value) => handleInputChange('date_of_birth', value)} 
              type="date"
            />
            <tr>
              <td className="py-2 font-semibold">Status:</td>
              <td className="py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">
                      {contact.is_inactive ? 'Inactive' : 'Active'}
                    </span>
                    <Switch
                      checked={!contact.is_inactive}
                      onCheckedChange={(checked) => handleInputChange('is_inactive', !checked)}
                      className="data-[state=checked]:bg-primary-500"
                    />
                  </div>
                </div>
              </td>
            </tr>
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
                  id={`${id}-tags`}
                  entityId={contact.contact_name_id}
                  entityType="contact"
                  initialTags={tags}
                  onTagsChange={handleTagsChange}
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-6 flex justify-end space-x-4">
          <Button
            id={`${id}-cancel-button`}
            variant="soft"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            id={`${id}-save-button`}
            variant="default"
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </div>
    </ReflectionContainer>
  );
};

interface TableRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

const TableRow: React.FC<TableRowProps> = ({ id, label, value, onChange, type = "text", options, placeholder }) => (
  <tr>
    <td className="py-2 font-semibold">{label}:</td>
    <td className="py-2">
      {options ? (
        <CustomSelect
          value={value}
          onValueChange={onChange}
          options={options}
        />
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
