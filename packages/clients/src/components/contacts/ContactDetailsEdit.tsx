'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ContactPhoneNumberInput, CreateContactInput, IClient, IContact, ITag } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Flex, Text, Heading } from '@radix-ui/themes';
import { updateContact, listInboundTicketDestinationOptions, getAllCountries, type ICountry, listContactPhoneTypeSuggestions, getCustomPhoneTypeUsageCount, deleteOrphanedPhoneTypes } from '@alga-psa/clients/actions';
import { findTagsByEntityIds } from '@alga-psa/tags/actions';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { TagManager } from '@alga-psa/tags/components';
import { useTags } from '@alga-psa/tags/context';
import { ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { ButtonComponent, FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';
import ContactAvatarUpload from './ContactAvatarUpload';
import { getContactAvatarUrlActionAsync } from '../../lib/usersHelpers';
import ContactPhoneNumbersEditor, {
  compactContactPhoneNumbers,
  translateContactPhoneValidationErrors,
  validateContactPhoneNumbers,
} from './ContactPhoneNumbersEditor';
import ContactEmailAddressesEditor, {
  compactContactEmailAddresses,
  validateContactEmailAddresses,
} from './ContactEmailAddressesEditor';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type EditableContact = IContact & {
  primary_email_custom_type?: string | null;
  additional_email_addresses?: CreateContactInput['additional_email_addresses'];
};

interface ContactDetailsEditProps {
  id?: string; // Made optional to maintain backward compatibility
  initialContact: IContact;
  clients: IClient[];
  onSave: (contact: IContact) => void;
  onCancel: () => void;
  isInDrawer?: boolean;
}

const ContactDetailsEdit: React.FC<ContactDetailsEditProps> = ({
  id = 'contact-edit',
  initialContact,
  clients,
  onSave,
  onCancel,
  isInDrawer = false
}) => {
  const { t } = useTranslation('msp/contacts');
  const [contact, setContact] = useState<EditableContact>({
    ...initialContact,
    additional_email_addresses: initialContact.additional_email_addresses ?? [],
  });
  const [tags, setTags] = useState<ITag[]>([]);
  const { tags: allTags } = useTags();
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [inboundDestinationOptions, setInboundDestinationOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [isInboundDestinationOptionsLoading, setIsInboundDestinationOptionsLoading] = useState(false);
  const [countries, setCountries] = useState<ICountry[]>([]);
  const [customPhoneTypeSuggestions, setCustomPhoneTypeSuggestions] = useState<string[]>([]);
  const [phoneValidationErrors, setPhoneValidationErrors] = useState<string[]>([]);
  const [emailValidationErrors, setEmailValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const fetchedTags = await findTagsByEntityIds([contact.contact_name_id], 'contact');
        setTags(fetchedTags);
        
        if (contact.tenant) {
          const contactAvatarUrl = await getContactAvatarUrlActionAsync(contact.contact_name_id, contact.tenant);
          setAvatarUrl(contactAvatarUrl);
        }
      } catch (err) {
        console.error('Error fetching data:', err);
      }
    };
    fetchData();
  }, [contact.contact_name_id, contact.tenant]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsInboundDestinationOptionsLoading(true);
      try {
        const rows = await listInboundTicketDestinationOptions();
        if (cancelled) return;
        setInboundDestinationOptions(
          (rows ?? []).map((row: any) => ({
            value: row.id,
            label: row.is_active
              ? `${row.display_name} (${row.short_name})`
              : `${row.display_name} (${row.short_name}) [${t('contactDetailsEdit.inactiveBadge', { defaultValue: 'inactive' })}]`,
          }))
        );
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading inbound ticket destination options:', err);
          setInboundDestinationOptions([]);
        }
      } finally {
        if (!cancelled) {
          setIsInboundDestinationOptionsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contact.contact_name_id, contact.tenant, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [countryRows, phoneTypeLabels] = await Promise.all([
          getAllCountries(),
          listContactPhoneTypeSuggestions(),
        ]);
        if (cancelled) return;
        setCountries(countryRows);
        setCustomPhoneTypeSuggestions(phoneTypeLabels);
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading phone metadata:', err);
          setCountries([]);
          setCustomPhoneTypeSuggestions([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleInputChange = <K extends keyof EditableContact,>(field: K, value: EditableContact[K]) => {
    setContact(prev => ({ ...prev, [field]: value }));
  };

  const handleClientSelect = (clientId: string | null) => {
    setContact(prev => ({ ...prev, client_id: clientId || '' }));
  };

  const handleSave = async () => {
    try {
      setError(null);
      
      // Validate required fields
      if (!contact.full_name?.trim()) {
        setError(t('contactDetailsEdit.validation.fullNameRequired', { defaultValue: 'Full name is required' }));
        return;
      }
      if (!contact.email?.trim()) {
        setError(t('contactDetailsEdit.validation.emailRequired', { defaultValue: 'Email address is required' }));
        return;
      }
      const currentEmailErrors = validateContactEmailAddresses(contact);
      setEmailValidationErrors(currentEmailErrors);
      if (currentEmailErrors.length > 0) {
        setError(currentEmailErrors[0]);
        return;
      }

      const currentPhoneErrors = translateContactPhoneValidationErrors(
        validateContactPhoneNumbers(contact.phone_numbers),
        t
      );
      setPhoneValidationErrors(currentPhoneErrors);
      if (currentPhoneErrors.length > 0) {
        setError(currentPhoneErrors[0]);
        return;
      }

      const compactedEmails = compactContactEmailAddresses(contact);
      const updatedContact = await updateContact({
        ...contact,
        ...compactedEmails,
        phone_numbers: compactContactPhoneNumbers(contact.phone_numbers),
      });

      // Clean up phone type definitions the user chose to delete
      if (phoneTypesToDeleteRef.current.length > 0) {
        try {
          await deleteOrphanedPhoneTypes(phoneTypesToDeleteRef.current);
        } catch {
          // Non-critical: type cleanup failure shouldn't block save
        }
        phoneTypesToDeleteRef.current = [];
      }

      onSave(updatedContact);
    } catch (err) {
      console.error('Error updating contact:', err);
      if (err instanceof Error) {
        // Handle specific error types with more detailed messages
        if (err.message.includes('VALIDATION_ERROR:')) {
          setError(err.message.replace(
            'VALIDATION_ERROR:',
            t('contactDetailsEdit.errors.validationPrefix', { defaultValue: 'Please fix the following:' })
          ));
        } else if (err.message.includes('EMAIL_EXISTS:')) {
          setError(t('contactDetailsEdit.errors.emailExists', {
            defaultValue: 'Email already exists: A contact with this email address already exists in the system'
          }));
        } else if (err.message.includes('FOREIGN_KEY_ERROR:')) {
          setError(err.message.replace(
            'FOREIGN_KEY_ERROR:',
            t('contactDetailsEdit.errors.invalidReferencePrefix', { defaultValue: 'Invalid reference:' })
          ));
        } else if (err.message.includes('SYSTEM_ERROR:')) {
          setError(err.message.replace(
            'SYSTEM_ERROR:',
            t('contactDetailsEdit.errors.systemPrefix', { defaultValue: 'System error:' })
          ));
        } else {
          console.log('Unhandled error:', err.message);
          setError(t('contactDetailsEdit.errors.saveFailed', {
            defaultValue: 'An error occurred while saving. Please try again.'
          }));
        }
      } else {
        setError(t('contactDetailsEdit.errors.unexpected', {
          defaultValue: 'An unexpected error occurred. Please try again.'
        }));
      }
    }
  };

  const handleTagsChange = (updatedTags: ITag[]) => {
    setTags(updatedTags);
  };

  const phoneTypesToDeleteRef = useRef<string[]>([]);

  const handleCheckCustomTypeUsage = useCallback(async (label: string) => {
    return getCustomPhoneTypeUsageCount(label);
  }, []);

  const handleDeleteOrphanedPhoneTypes = useCallback(async (labels: string[]) => {
    // Record intent to delete these types after save
    phoneTypesToDeleteRef.current = [
      ...phoneTypesToDeleteRef.current,
      ...labels.filter(l => !phoneTypesToDeleteRef.current.includes(l)),
    ];
  }, []);

  return (
    <ReflectionContainer
      id={id}
      label={t('contactDetailsEdit.title', {
        defaultValue: 'Edit Contact - {{name}}',
        name: contact.full_name
      })}
    >
      <div className="p-6 bg-white shadow rounded-lg">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-between items-center mb-4">
          <Heading size="6">
            {t('contactDetailsEdit.heading', {
              defaultValue: 'Edit Contact: {{name}}',
              name: contact.full_name
            })}
          </Heading>
        </div>
        
        {/* Contact Avatar Upload */}
        <div className="mb-6">
          <ContactAvatarUpload
            contactId={contact.contact_name_id}
            contactName={contact.full_name}
            currentAvatarUrl={avatarUrl}
            onAvatarUpdated={(newAvatarUrl) => setAvatarUrl(newAvatarUrl)}
          />
        </div>
        <table className="min-w-full">
          <tbody>
            <TableRow 
              id={`${id}-full-name`}
              label={t('contactDetailsEdit.fields.fullName', { defaultValue: 'Full Name' })} 
              value={contact.full_name} 
              onChange={(value) => handleInputChange('full_name', value)} 
            />
            <tr>
              <td className="py-2 font-semibold align-top">
                {t('contactDetailsEdit.fields.emailAddresses', { defaultValue: 'Email addresses:' })}
              </td>
              <td className="py-2">
                <ContactEmailAddressesEditor
                  id={`${id}-email`}
                  value={contact}
                  onChange={(value) => setContact((previousContact) => ({ ...previousContact, ...value }))}
                  customTypeSuggestions={[]}
                  errorMessages={emailValidationErrors}
                  onValidationChange={setEmailValidationErrors}
                />
              </td>
            </tr>
            <TableRow 
              id={`${id}-role`}
              label={t('contactDetailsEdit.fields.role', { defaultValue: 'Role' })} 
              value={contact.role || ''} 
              onChange={(value) => handleInputChange('role', value)} 
              placeholder={t('contactDetailsEdit.fields.rolePlaceholder', {
                defaultValue: 'e.g., Manager, Developer, etc.'
              })}
            />
            <tr>
              <td className="py-2 font-semibold align-top">
                {t('contactDetailsEdit.fields.phoneNumbers', { defaultValue: 'Phone numbers:' })}
              </td>
              <td className="py-2">
                <ContactPhoneNumbersEditor
                  id={`${id}-phone`}
                  value={contact.phone_numbers}
                  onChange={(rows) => handleInputChange('phone_numbers', rows)}
                  countries={countries}
                  customTypeSuggestions={customPhoneTypeSuggestions}
                  errorMessages={phoneValidationErrors}
                  onValidationChange={setPhoneValidationErrors}
                  onCheckCustomTypeUsage={handleCheckCustomTypeUsage}
                  onDeleteOrphanedPhoneTypes={handleDeleteOrphanedPhoneTypes}
                />
              </td>
            </tr>
            <tr>
              <td className="py-2 font-semibold">
                {t('contactDetailsEdit.fields.inboundTicketDestinationOverride', {
                  defaultValue: 'Inbound ticket destination override:'
                })}
              </td>
              <td className="py-2">
                <CustomSelect
                  id={`${id}-inbound-ticket-destination-select`}
                  value={(contact as any).inbound_ticket_defaults_id || ''}
                  onValueChange={(value) => handleInputChange('inbound_ticket_defaults_id', value)}
                  options={inboundDestinationOptions}
                  allowClear={true}
                  placeholder={
                    isInboundDestinationOptionsLoading
                      ? t('contactDetailsEdit.loading.destinations', { defaultValue: 'Loading destinations...' })
                      : t('contactDetailsEdit.fields.useClientDestination', { defaultValue: 'Use client destination' })
                  }
                  disabled={isInboundDestinationOptionsLoading}
                />
                <Text size="1" className="text-gray-500">
                  {t('contactDetailsEdit.fields.inboundTicketDestinationHelp', {
                    defaultValue: 'Precedence: Contact override -> Client destination -> Provider default.'
                  })}
                </Text>
              </td>
            </tr>
            <tr>
              <td className="py-2 font-semibold">
                {t('contactDetailsEdit.fields.client', { defaultValue: 'Client:' })}
              </td>
              <td className="py-2">
                <ClientPicker
                  id={`${id}-client-picker`}
                  clients={clients}
                  onSelect={handleClientSelect}
                  selectedClientId={contact.client_id}
                  filterState={filterState}
                  onFilterStateChange={setFilterState}
                  clientTypeFilter={clientTypeFilter}
                  onClientTypeFilterChange={setClientTypeFilter}
                />
              </td>
            </tr>
            <tr>
              <td className="py-2 font-semibold">
                {t('contactDetailsEdit.fields.status', { defaultValue: 'Status:' })}
              </td>
              <td className="py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">
                      {contact.is_inactive
                        ? t('contactDetailsEdit.status.inactive', { defaultValue: 'Inactive' })
                        : t('contactDetailsEdit.status.active', { defaultValue: 'Active' })}
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
              <td className="py-2 font-semibold">
                {t('contactDetailsEdit.fields.notes', { defaultValue: 'Notes:' })}
              </td>
              <td className="py-2">
                <TextArea
                  value={contact.notes || ''}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  placeholder={t('contactDetailsEdit.fields.notesPlaceholder', {
                    defaultValue: 'Add any additional notes about the contact...'
                  })}
                />
              </td>
            </tr>
            <tr>
              <td className="py-2 font-semibold">
                {t('contactDetailsEdit.fields.tags', { defaultValue: 'Tags:' })}
              </td>
              <td className="py-2">
                <TagManager
                  id={`${id}-tags`}
                  entityId={contact.contact_name_id}
                  entityType="contact"
                  initialTags={tags}
                  onTagsChange={handleTagsChange}
                  useInlineInput={isInDrawer}
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
            {t('common.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id={`${id}-save-button`}
            variant="default"
            onClick={handleSave}
          >
            {t('common.actions.save', { defaultValue: 'Save' })}
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
