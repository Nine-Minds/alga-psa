'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ContactPhoneNumberInput, IClient, IClientLocation } from '@alga-psa/types';
import { IContact } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import { Input } from '@alga-psa/ui/components/Input';
import { PhoneInput } from '@alga-psa/ui/components/PhoneInput';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogFooter
} from '@alga-psa/ui/components/Dialog';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getAllUsersBasicAsync } from '../../lib/usersHelpers';
import { createClient, createClientLocation, getAllCountries, ICountry, listContactPhoneTypeSuggestions } from '@alga-psa/clients/actions';
import { createClientContact } from '@alga-psa/clients/actions';
import CountryPicker from '@alga-psa/ui/components/CountryPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import ClientCreatedDialog from './ClientCreatedDialog';
import { QuickAddTagPicker } from '@alga-psa/tags/components';
import type { PendingTag } from '@alga-psa/types';
import { createTagsForEntity } from '@alga-psa/tags/actions';
import { 
  validateClientForm, 
  validateClientName, 
  validateWebsiteUrl, 
  validateEmailAddress, 
  validatePhoneNumber, 
  validatePostalCode, 
  validateCityName, 
  validateAddress, 
  validateContactName,
  validateStateProvince,
  validateIndustry,
  validateNotes
} from '@alga-psa/validation';
import ContactPhoneNumbersEditor, {
  compactContactPhoneNumbers,
  validateContactPhoneNumbers,
} from '../contacts/ContactPhoneNumbersEditor';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type CreateClientData = Omit<IClient, "client_id" | "created_at" | "updated_at" | "notes_document_id" | "status" | "tenant" | "deleted_at">;

type CreateLocationData = Omit<IClientLocation, "location_id" | "tenant" | "created_at" | "updated_at">;

type CreateContactData = Pick<IContact, 'full_name' | 'email' | 'role' | 'notes'> & {
  phone_numbers: ContactPhoneNumberInput[];
};

interface QuickAddClientProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClientAdded: (client: IClient) => void;
  trigger?: React.ReactNode;
  skipSuccessDialog?: boolean;
}

const QuickAddClient: React.FC<QuickAddClientProps> = ({
  open,
  onOpenChange,
  onClientAdded,
  trigger,
  skipSuccessDialog = false,
}) => {
  const { t } = useTranslation('msp/clients');
  const initialFormData: CreateClientData = {
    client_name: '',
    client_type: 'company',
    url: '',
    notes: '',
    is_inactive: false,
    is_tax_exempt: false,
    billing_cycle: 'monthly' as const,
    properties: {
      industry: '',
      company_size: '',
      annual_revenue: '',
      website: '',
    },
    account_manager_id: null,
    credit_balance: 0
  };

  const initialLocationData: CreateLocationData = {
    client_id: '',
    location_name: 'Main Office',
    address_line1: '',
    address_line2: '',
    address_line3: '',
    city: '',
    state_province: '',
    postal_code: '',
    country_code: 'US',
    country_name: 'United States',
    region_code: null,
    is_billing_address: true,
    is_shipping_address: true,
    is_default: true,
    phone: '',
    fax: '',
    email: '',
    notes: '',
    is_active: true,
  };

  const initialContactData: CreateContactData = {
    full_name: '',
    phone_numbers: [],
    email: '',
    role: '',
    notes: '',
  };

  const [formData, setFormData] = useState<CreateClientData>(initialFormData);
  const [locationData, setLocationData] = useState<CreateLocationData>(initialLocationData);
  const [contactData, setContactData] = useState<CreateContactData>(initialContactData);
  const [contactPhoneValidationErrors, setContactPhoneValidationErrors] = useState<string[]>([]);
  const [customPhoneTypeSuggestions, setCustomPhoneTypeSuggestions] = useState<string[]>([]);
  const [internalUsers, setInternalUsers] = useState<IUser[]>([]);
  const [countries, setCountries] = useState<ICountry[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingCountries, setIsLoadingCountries] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdClient, setCreatedClient] = useState<IClient | null>(null);
  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);
  const router = useRouter();

  const getPrimaryContactPhone = (rows: ContactPhoneNumberInput[]): string => {
    return compactContactPhoneNumbers(rows).find((row) => row.is_default)?.phone_number ?? '';
  };

  const hasAnyContactData = (data: CreateContactData): boolean => {
    return !!(
      data.full_name.trim() ||
      (data.email ?? '').trim() ||
      compactContactPhoneNumbers(data.phone_numbers).length > 0 ||
      (data.role ?? '').trim()
    );
  };

  useEffect(() => {
    if (open) {
      const fetchUsers = async () => {
        if (isLoadingUsers || internalUsers.length > 0) return;
        setIsLoadingUsers(true);
        try {
          const users = await getAllUsersBasicAsync();
          setInternalUsers(users);
        } catch (error: any) {
          handleError(error, t('quickAddClient.usersLoadError', {
            defaultValue: 'Failed to load users for Account Manager selection.',
          }));
        } finally {
          setIsLoadingUsers(false);
        }
      };

      const fetchCountries = async () => {
        if (isLoadingCountries || countries.length > 0) return;
        setIsLoadingCountries(true);
        try {
          const countriesData = await getAllCountries();
          setCountries(countriesData);
        } catch (error: any) {
          handleError(error, t('quickAddClient.countriesLoadError', {
            defaultValue: 'Failed to load countries.',
          }));
        } finally {
          setIsLoadingCountries(false);
        }
      };

      const fetchPhoneTypeSuggestions = async () => {
        try {
          const labels = await listContactPhoneTypeSuggestions();
          setCustomPhoneTypeSuggestions(labels);
        } catch (error: any) {
          handleError(error, t('quickAddClient.phoneTypeSuggestionsError', {
            defaultValue: 'Failed to load contact phone type suggestions.',
          }));
        }
      };


      fetchUsers();
      fetchCountries();
      fetchPhoneTypeSuggestions();
    } else {
      setFormData(initialFormData);
      setLocationData(initialLocationData);
      setContactData(initialContactData);
      setContactPhoneValidationErrors([]);
      setIsSubmitting(false);
      setError(null);
      setHasAttemptedSubmit(false);
      setValidationErrors([]);
      setFieldErrors({});
      setPendingTags([]);
    }
  }, [open]);

  // Enterprise-grade field validation function (Microsoft/Meta/Salesforce style)
  const validateField = (fieldName: string, value: string, additionalData?: any, isSubmitting: boolean = false) => {
    let error: string | null = null;
    const trimmedValue = value.trim();

    // Handle spaces-only input for all fields
    if (/^\s+$/.test(value)) {
      const fieldDisplayNames: Record<string, string> = {
        'company_name': 'Company name',
        'url': 'Website URL',
        'industry': 'Industry',
        'location_email': 'Email address',
        'location_phone': 'Phone number',
        'postal_code': 'Postal code',
        'city': 'City',
        'state_province': 'State/Province',
        'address_line1': 'Address',
        'contact_name': 'Contact name',
        'contact_email': 'Contact email',
        'contact_phone': 'Contact phone',
        'notes': 'Notes'
      };
      const displayName = fieldDisplayNames[fieldName] || 'Field';
      error = `${displayName} cannot contain only spaces`;
      setFieldErrors(prev => ({
        ...prev,
        [fieldName]: error || ''
      }));
      return error;
    }

    // If field is empty, only validate required fields
    if (!trimmedValue) {
      // Only client name is required, all other fields are optional
      if (fieldName === 'client_name' && isSubmitting) {
        error = 'Client name is required';
      }
      // For optional fields, clear any existing errors when empty
      setFieldErrors(prev => ({
        ...prev,
        [fieldName]: ''
      }));
      return error;
    }
    
    switch (fieldName) {
      case 'client_name':
        error = validateClientName(value);
        break;
      case 'url':
        error = validateWebsiteUrl(value);
        break;
      case 'industry':
        error = validateIndustry(value);
        break;
      case 'location_email':
        error = validateEmailAddress(value);
        break;
      case 'location_phone':
        // Enterprise phone validation - Unicode international support
        if (trimmedValue) {
          // Check if this is just a country code (like "+1 " or "+44 ") with no actual phone number
          const countryCodeOnlyPattern = /^\+\d{1,4}\s*$/;
          if (countryCodeOnlyPattern.test(trimmedValue)) {
            // Don't validate if it's just a country code - user hasn't started typing yet
            break;
          }

          // Extract all Unicode digits (supports international number systems)
          const unicodeDigits = trimmedValue.replace(/[\s\-\(\)\+\.\p{P}\p{S}]/gu, '').match(/\p{N}/gu) || [];
          const digitCount = unicodeDigits.length;

          // International phone number validation (ITU-T E.164)
          if (digitCount > 0 && digitCount < 7) {
            error = 'Please enter a complete phone number (at least 7 digits)';
          } else if (digitCount > 15) {
            error = 'Phone number cannot exceed 15 digits';
          } else if (digitCount > 0) {
            // Check for obviously fake patterns using Unicode digits
            const unicodeDigitString = unicodeDigits.join('');
            if (/^(.)\1+$/u.test(unicodeDigitString)) {
              error = 'Please enter a valid phone number';
            } else if (/^(123|111|000|999)/u.test(unicodeDigitString) && digitCount >= 7) {
              error = 'Please enter a valid phone number';
            } else {
              // Use the existing validator for more complex validation
              error = validatePhoneNumber(trimmedValue);
            }
          }
        }
        break;
      case 'contact_phone':
        // Same enterprise phone validation for contact phone - Unicode support
        if (trimmedValue) {
          // Check if this is just a country code (like "+1 " or "+44 ") with no actual phone number
          const countryCodeOnlyPattern = /^\+\d{1,4}\s*$/;
          if (countryCodeOnlyPattern.test(trimmedValue)) {
            // Don't validate if it's just a country code - user hasn't started typing yet
            break;
          }

          // Extract all Unicode digits (supports international number systems)
          const unicodeDigits = trimmedValue.replace(/[\s\-\(\)\+\.\p{P}\p{S}]/gu, '').match(/\p{N}/gu) || [];
          const digitCount = unicodeDigits.length;

          if (digitCount > 0 && digitCount < 7) {
            error = 'Please enter a complete phone number (at least 7 digits)';
          } else if (digitCount > 15) {
            error = 'Phone number cannot exceed 15 digits';
          } else if (digitCount > 0) {
            const unicodeDigitString = unicodeDigits.join('');
            if (/^(.)\1+$/u.test(unicodeDigitString)) {
              error = 'Please enter a valid phone number';
            } else if (/^(123|111|000|999)/u.test(unicodeDigitString) && digitCount >= 7) {
              error = 'Please enter a valid phone number';
            } else {
              error = validatePhoneNumber(trimmedValue);
            }
          }
        }
        break;
      case 'postal_code':
        error = validatePostalCode(value, additionalData?.countryCode);
        break;
      case 'city':
        error = validateCityName(value);
        break;
      case 'state_province':
        error = validateStateProvince(value);
        break;
      case 'address_line1':
        error = validateAddress(value);
        break;
      case 'contact_name':
        error = validateContactName(value);
        break;
      case 'contact_email':
        error = validateEmailAddress(value);
        break;
      case 'notes':
        error = validateNotes(value);
        break;
    }
    
    setFieldErrors(prev => ({
      ...prev,
      [fieldName]: error || ''
    }));
    
    return error;
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setHasAttemptedSubmit(true);
    
    // Comprehensive validation
    const validationResult = validateClientForm({
      clientName: formData.client_name,
      websiteUrl: formData.url,
      industry: formData.properties?.industry,
      email: locationData.email,
      phone: locationData.phone,
      address: locationData.address_line1,
      city: locationData.city,
      stateProvince: locationData.state_province,
      postalCode: locationData.postal_code,
      countryCode: locationData.country_code,
      contactName: contactData.full_name,
      contactEmail: contactData.email ?? '',
      contactPhone: getPrimaryContactPhone(contactData.phone_numbers),
      notes: formData.notes
    });

    // Cross-field validation: if any contact field is filled, require name and email
    if (hasAnyContactData(contactData)) {
      if (!contactData.full_name.trim()) {
        validationResult.isValid = false;
        validationResult.errors.contact_name = 'Full name is required when adding a contact';
      }
      if (!(contactData.email ?? '').trim()) {
        validationResult.isValid = false;
        validationResult.errors.contact_email = 'Email is required when adding a contact';
      }
    }

    const currentContactPhoneErrors = validateContactPhoneNumbers(contactData.phone_numbers);
    setContactPhoneValidationErrors(currentContactPhoneErrors);
    if (currentContactPhoneErrors.length > 0) {
      validationResult.isValid = false;
      validationResult.errors.contact_phone = currentContactPhoneErrors[0];
    }
    
    // Early return if validation fails - prevent async operations
    if (!validationResult.isValid) {
      setFieldErrors(validationResult.errors);
      const errorMessages = Object.values(validationResult.errors).filter(Boolean);
      setValidationErrors(errorMessages);
      return; // Stop here - don't proceed with async submit logic
    }

    setIsSubmitting(true);
    setError(null);
    setValidationErrors([]);
    try {
      const dataToSend = {
        ...formData,
        properties: formData.properties,
        account_manager_id: formData.account_manager_id === '' ? null : formData.account_manager_id
      };

      const result = await createClient(dataToSend);

      if (!result.success) {
        setError((result as { success: false; error: string }).error);
        setIsSubmitting(false);
        return;
      }

      const newClient = result.data;

      // Create location if any location data is provided (address, city, phone, or email)
      // Check if phone has actual number, not just country code
      const phoneCode = countries.find(c => c.code === locationData.country_code)?.phone_code || '';
      const hasActualPhone = locationData.phone?.trim() && 
                            locationData.phone.trim() !== phoneCode &&
                            locationData.phone.replace(/\s+/g, '').length > phoneCode.length;
      
      if (locationData.address_line1.trim() || locationData.city.trim() || 
          hasActualPhone || locationData.email?.trim()) {
        try {
          await createClientLocation(newClient.client_id, locationData);
        } catch (locationError) {
          handleError(locationError, "Client created but failed to add location.");
        }
      }

      // Create contact if contact data is provided
      if (contactData.full_name.trim() || (contactData.email ?? '').trim()) {
        try {
          await createClientContact({
            clientId: newClient.client_id,
            fullName: contactData.full_name,
            email: contactData.email ?? '',
            phoneNumbers: compactContactPhoneNumbers(contactData.phone_numbers),
            jobTitle: contactData.role ?? undefined,
          });
        } catch (contactError) {
          handleError(contactError, "Client created but failed to add contact.");
        }
      }

      // Create tags for the new client
      let createdTags: typeof newClient.tags = [];
      if (pendingTags.length > 0) {
        try {
          createdTags = await createTagsForEntity(newClient.client_id, 'client', pendingTags);
          if (createdTags.length < pendingTags.length) {
            toast.error(`${pendingTags.length - createdTags.length} tag(s) could not be created`);
          }
        } catch (tagError) {
          console.error("Error creating client tags:", tagError);
        }
      }

      // Pass client with tags to callback
      const clientWithTags = { ...newClient, tags: createdTags };
      onClientAdded(clientWithTags);
      onOpenChange(false);
      if (!skipSuccessDialog) {
        setCreatedClient(clientWithTags);
        setShowSuccess(true);
      }
      } catch (error: any) {
      console.error("Error creating client:", error);
      const errorMessage = error.message || "Failed to create client. Please try again.";
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };


  const handleClientChange = (field: string, value: string | boolean | null) => {
    setFormData(prev => {
      const updatedState = { ...prev };

      if (field.startsWith('properties.') && field !== 'properties.account_manager_id') {
        const propertyField = field.split('.')[1];
        if (!updatedState.properties) {
          updatedState.properties = {};
        }
        (updatedState.properties as any)[propertyField] = value;

        if (propertyField === 'website') {
          updatedState.url = value as string;
        }
      } else if (field === 'url') {
        updatedState.url = value as string;
        if (!updatedState.properties) {
          updatedState.properties = {};
        }
        updatedState.properties.website = value as string;
      } else if (field !== 'address') {
        (updatedState as any)[field] = value;
      }
      return updatedState;
    });
    
    // Clear errors when user starts typing
    const errorField = field.startsWith('properties.') ? field.split('.')[1] : field;
    if (fieldErrors[errorField]) {
      setFieldErrors(prev => ({
        ...prev,
        [errorField]: ''
      }));
    }
  };

  const handleLocationChange = (field: keyof CreateLocationData, value: string | boolean | null) => {
    setLocationData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear errors when user starts typing
    const validationFieldMap: Record<string, string> = {
      'email': 'location_email',
      'phone': 'location_phone',
      'postal_code': 'postal_code',
      'city': 'city',
      'state_province': 'state_province',
      'address_line1': 'address_line1'
    };
    
    const validationField = validationFieldMap[field as string];
    if (validationField && fieldErrors[validationField]) {
      setFieldErrors(prev => ({
        ...prev,
        [validationField]: ''
      }));
    }
  };

  const handleContactChange = (field: keyof CreateContactData, value: string | ContactPhoneNumberInput[]) => {
    setContactData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear errors when user starts typing
    const validationFieldMap: Record<string, string> = {
      'full_name': 'contact_name',
      'email': 'contact_email',
      'phone_numbers': 'contact_phone'
    };
    
    const validationField = validationFieldMap[field as string];
    if (validationField && fieldErrors[validationField]) {
      setFieldErrors(prev => ({
        ...prev,
        [validationField]: ''
      }));
    }
  };

  const handleCountryChange = (countryCode: string, countryName: string) => {
    setLocationData(prev => ({
      ...prev,
      country_code: countryCode,
      country_name: countryName
    }));
  };

  // Comprehensive form validation check for submit button state
  const isFormValid = () => {
    // Required field: Company name
    if (!formData.company_name || !formData.company_name.trim()) {
      return false;
    }

    // Check for any existing field errors
    if (Object.values(fieldErrors).some(error => error && error.trim() !== '')) {
      return false;
    }

    // Validate all fields real-time without showing errors
    const companyNameError = validateField('company_name', formData.company_name, undefined, false);
    if (companyNameError) return false;

    // Optional field validations - only if they have content
    if (formData.url && formData.url.trim()) {
      const urlError = validateField('url', formData.url, undefined, false);
      if (urlError) return false;
    }

    if (formData.properties?.industry && formData.properties.industry.trim()) {
      const industryError = validateField('industry', formData.properties.industry, undefined, false);
      if (industryError) return false;
    }

    // Location validations - only if they have content
    if (locationData.email && locationData.email.trim()) {
      const emailError = validateField('location_email', locationData.email, undefined, false);
      if (emailError) return false;
    }

    if (locationData.phone && locationData.phone.trim()) {
      const phoneError = validateField('location_phone', locationData.phone, undefined, false);
      if (phoneError) return false;
    }

    if (locationData.postal_code && locationData.postal_code.trim()) {
      const postalError = validateField('postal_code', locationData.postal_code, { countryCode: locationData.country_code }, false);
      if (postalError) return false;
    }

    if (locationData.city && locationData.city.trim()) {
      const cityError = validateField('city', locationData.city, undefined, false);
      if (cityError) return false;
    }

    if (locationData.state_province && locationData.state_province.trim()) {
      const stateError = validateField('state_province', locationData.state_province, undefined, false);
      if (stateError) return false;
    }

    if (locationData.address_line1 && locationData.address_line1.trim()) {
      const addressError = validateField('address_line1', locationData.address_line1, undefined, false);
      if (addressError) return false;
    }

    // Contact validations - if any contact field is filled, require name and email
    if (hasAnyContactData(contactData)) {
      if (!contactData.full_name.trim()) return false;
      if (!(contactData.email ?? '').trim()) return false;
    }

    if (contactData.full_name && contactData.full_name.trim()) {
      const nameError = validateField('contact_name', contactData.full_name, undefined, false);
      if (nameError) return false;
    }

    if (contactData.email && contactData.email.trim()) {
      const contactEmailError = validateField('contact_email', contactData.email, undefined, false);
      if (contactEmailError) return false;
    }

    if (contactData.phone_numbers.length > 0) {
      const contactPhoneErrors = validateContactPhoneNumbers(contactData.phone_numbers);
      if (contactPhoneErrors.length > 0) return false;
    }

    if (contactData.notes && contactData.notes.trim()) {
      const notesError = validateField('notes', contactData.notes, undefined, false);
      if (notesError) return false;
    }

    return true;
  };


  return (
    <>
    <Dialog
      id="quick-add-client-dialog"
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={t('quickAddClient.title', { defaultValue: 'Add New Client' })}
      disableFocusTrap>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <form onSubmit={handleSubmit} id="quick-add-client-form" noValidate>
          <div className="max-h-[60vh] overflow-y-auto px-1 py-4 space-y-6">
            
            {/* Validation Errors */}
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  <p className="font-medium mb-2">
                    {t('quickAddClient.validationHeader', { defaultValue: 'Please correct the following errors:' })}
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((err, index) => (
                      <li key={index}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            
            {/* Error Alert */}
            {error && (
              <Alert variant="destructive" data-automation-id="client-creation-error-alert">
                <AlertDescription>
                  {error}
                </AlertDescription>
              </Alert>
            )}
            
            {/* Client Details Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                {t('quickAddClient.clientDetails', { defaultValue: 'Client Details' })}
              </h3>
              
              <div>
                <Label htmlFor="client_name" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('quickAddClient.clientName', { defaultValue: 'Client Name *' })}
                </Label>
                <Input
                  id="client-name"
                  data-automation-id="client-name-input"
                  value={formData.client_name}
                  onChange={(e) => {
                    handleClientChange('client_name', e.target.value);
                  }}
                  onBlur={() => {
                    validateField('client_name', formData.client_name);
                  }}
                  placeholder={t('quickAddClient.enterClientName', { defaultValue: 'Enter client name' })}
                  disabled={isSubmitting}
                  className={`w-full text-lg font-semibold p-2 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.client_name ? 'border-red-500' : 'border-gray-300'}`}
                />
                {fieldErrors.client_name && (
                  <p className="text-sm text-red-600 mt-1">{fieldErrors.client_name}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="client-type-select" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.clientType', { defaultValue: 'Client Type' })}
                  </Label>
                  <CustomSelect
                    id="client-type-select"
                    data-automation-id="client-type-select"
                    options={[
                      { value: 'company', label: t('quickAddClient.company', { defaultValue: 'Company' }) },
                      { value: 'individual', label: t('quickAddClient.individual', { defaultValue: 'Individual' }) }
                    ]}
                    value={formData.client_type}
                    onValueChange={(value) => handleClientChange('client_type', value)}
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <Label htmlFor="industry" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.industry', { defaultValue: 'Industry' })}
                  </Label>
                  <Input
                    id="industry"
                    data-automation-id="industry"
                    value={formData.properties?.industry || ''}
                    onChange={(e) => handleClientChange('properties.industry', e.target.value)}
                    onBlur={() => {
                      validateField('industry', formData.properties?.industry || '');
                    }}
                    disabled={isSubmitting}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.industry ? 'border-red-500' : 'border-gray-300'}`}
                  />
                  {fieldErrors.industry && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.industry}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.websiteUrl', { defaultValue: 'Website URL' })}
                  </Label>
                  <Input
                    id="url"
                    data-automation-id="url"
                    value={formData.url}
                    onChange={(e) => handleClientChange('url', e.target.value)}
                    onBlur={() => {
                      validateField('url', formData.url);
                    }}
                    placeholder="https://example.com"
                    disabled={isSubmitting}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.url ? 'border-red-500' : 'border-gray-300'}`}
                  />
                  {fieldErrors.url && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.url}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="account-manager-picker" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.accountManager', { defaultValue: 'Account Manager' })}
                  </Label>
                  <UserPicker
                    id="account-manager-picker"
                    data-automation-id="account-manager-picker"
                    value={formData.account_manager_id || ''}
                    onValueChange={(value) => handleClientChange('account_manager_id', value)}
                    users={internalUsers}
                    getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                    disabled={isLoadingUsers || isSubmitting}
                    placeholder={isLoadingUsers
                      ? t('quickAddClient.loadingUsers', { defaultValue: 'Loading users...' })
                      : t('quickAddClient.selectAccountManager', { defaultValue: 'Select Account Manager' })}
                    buttonWidth="full"
                  />
                </div>
              </div>

              {/* Tags */}
              <QuickAddTagPicker
                id="quick-add-client-tags"
                entityType="client"
                pendingTags={pendingTags}
                onPendingTagsChange={setPendingTags}
                disabled={isSubmitting}
              />
            </div>

            {/* Client Location Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                {t('quickAddClient.clientLocation', { defaultValue: 'Client Location' })}
              </h3>
              
              <div>
                <Label htmlFor="address-line-1" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('quickAddClient.streetAddress', { defaultValue: 'Street Address' })}
                </Label>
                <Input
                  id="address-line-1"
                  data-automation-id="address-line-1"
                  value={locationData.address_line1}
                  onChange={(e) => handleLocationChange('address_line1', e.target.value)}
                  onBlur={() => {
                    validateField('address_line1', locationData.address_line1);
                  }}
                  disabled={isSubmitting}
                  className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.address_line1 ? 'border-red-500' : 'border-gray-300'}`}
                />
                {fieldErrors.address_line1 && (
                  <p className="text-sm text-red-600 mt-1">{fieldErrors.address_line1}</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.city', { defaultValue: 'City' })}
                  </Label>
                  <Input
                    id="city"
                    data-automation-id="city"
                    value={locationData.city}
                    onChange={(e) => handleLocationChange('city', e.target.value)}
                    onBlur={() => {
                      validateField('city', locationData.city);
                    }}
                    disabled={isSubmitting}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.city ? 'border-red-500' : 'border-gray-300'}`}
                  />
                  {fieldErrors.city && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.city}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="state-province" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.state', { defaultValue: 'State' })}
                  </Label>
                  <Input
                    id="state-province"
                    data-automation-id="state-province"
                    value={locationData.state_province || ''}
                    onChange={(e) => handleLocationChange('state_province', e.target.value)}
                    onBlur={() => {
                      validateField('state_province', locationData.state_province || '');
                    }}
                    disabled={isSubmitting}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.state_province ? 'border-red-500' : 'border-gray-300'}`}
                  />
                  {fieldErrors.state_province && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.state_province}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="client-postal-code" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.zipCode', { defaultValue: 'Zip Code' })}
                  </Label>
                  <Input
                    id="client-postal-code"
                    data-automation-id="client-postal-code"
                    value={locationData.postal_code || ''}
                    onChange={(e) => handleLocationChange('postal_code', e.target.value)}
                    onBlur={() => {
                      validateField('postal_code', locationData.postal_code || '', { countryCode: locationData.country_code });
                    }}
                    disabled={isSubmitting}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.postal_code ? 'border-red-500' : 'border-gray-300'}`}
                  />
                  {fieldErrors.postal_code && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.postal_code}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="country-picker" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.country', { defaultValue: 'Country' })}
                  </Label>
                  <CountryPicker
                    id="country-picker"
                    data-automation-id="country-picker"
                    value={locationData.country_code}
                    onValueChange={handleCountryChange}
                    countries={countries}
                    disabled={isLoadingCountries || isSubmitting}
                    placeholder={isLoadingCountries
                      ? t('quickAddClient.loadingCountries', { defaultValue: 'Loading countries...' })
                      : t('quickAddClient.selectCountry', { defaultValue: 'Select Country' })}
                    buttonWidth="full"
                  />
                </div>

                <div>
                  <PhoneInput
                    id="client-location-phone"
                    label={t('quickAddClient.phone', { defaultValue: 'Phone' })}
                    value={locationData.phone || ''}
                    onChange={(value) => {
                      handleLocationChange('phone', value);
                      // Clear error when user starts typing, clears the field, or has only country code
                      const trimmedValue = value.trim();
                      const isCountryCodeOnly = /^\+\d{1,4}\s*$/.test(trimmedValue);

                      if (fieldErrors.location_phone && (trimmedValue === '' || isCountryCodeOnly)) {
                        setFieldErrors(prev => ({ ...prev, location_phone: '' }));
                      }
                    }}
                    onBlur={() => {
                      validateField('location_phone', locationData.phone || '');
                    }}
                    countryCode={locationData.country_code}
                    phoneCode={countries.find(c => c.code === locationData.country_code)?.phone_code}
                    countries={countries}
                    onCountryChange={(countryCode) => handleCountryChange(countryCode, countries.find(c => c.code === countryCode)?.name || '')}
                    allowExtensions={true}
                    disabled={isSubmitting}
                    data-automation-id="client-location-phone"
                  />
                  {fieldErrors.location_phone && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.location_phone}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="client-location-email" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.email', { defaultValue: 'Email' })}
                  </Label>
                  <Input
                    id="client-location-email"
                    data-automation-id="client-location-email"
                    type="email"
                    value={locationData.email || ''}
                    onChange={(e) => {
                      handleLocationChange('email', e.target.value);
                      // Immediately validate if user enters only spaces
                      if (/^\s+$/.test(e.target.value)) {
                        setFieldErrors(prev => ({ ...prev, location_email: 'Email address cannot contain only spaces' }));
                      }
                    }}
                    onBlur={() => {
                      validateField('location_email', locationData.email || '');
                    }}
                    disabled={isSubmitting}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.location_email ? 'border-red-500' : 'border-gray-300'}`}
                  />
                  {fieldErrors.location_email && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.location_email}</p>
                  )}
                </div>
              </div>
            </div>


            {/* Contact Information Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                {t('quickAddClient.contactInformation', { defaultValue: 'Contact Information' })}
              </h3>
              
              <div>
                <Label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name{hasAnyContactData(contactData) ? ' *' : ''}
                </Label>
                <Input
                  id="contact-name"
                  data-automation-id="contact-name"
                  value={contactData.full_name}
                  onChange={(e) => handleContactChange('full_name', e.target.value)}
                  onBlur={() => {
                    validateField('contact_name', contactData.full_name);
                  }}
                  disabled={isSubmitting}
                  className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.contact_name ? 'border-red-500' : 'border-gray-300'}`}
                />
                {fieldErrors.contact_name && (
                  <p className="text-sm text-red-600 mt-1">{fieldErrors.contact_name}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="client-contact-email" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAddClient.email', { defaultValue: 'Email' })}{hasAnyContactData(contactData) ? ' *' : ''}
                  </Label>
                  <Input
                    id="client-contact-email"
                    data-automation-id="client-contact-email"
                    type="email"
                    value={contactData.email ?? ''}
                    onChange={(e) => {
                      handleContactChange('email', e.target.value);
                      if (/^\s+$/.test(e.target.value)) {
                        setFieldErrors(prev => ({ ...prev, contact_email: 'Email address cannot contain only spaces' }));
                      }
                    }}
                    onBlur={() => {
                      validateField('contact_email', contactData.email ?? '');
                    }}
                    disabled={isSubmitting}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.contact_email ? 'border-red-500' : 'border-gray-300'}`}
                  />
                  {fieldErrors.contact_email && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.contact_email}</p>
                  )}
                </div>

                <div className="col-span-2">
                  <ContactPhoneNumbersEditor
                    id="client-contact-phone"
                    value={contactData.phone_numbers}
                    onChange={(rows) => {
                      handleContactChange('phone_numbers', rows);
                      if (fieldErrors.contact_phone) {
                        setFieldErrors(prev => ({ ...prev, contact_phone: '' }));
                      }
                    }}
                    countries={countries}
                    customTypeSuggestions={customPhoneTypeSuggestions}
                    disabled={isSubmitting}
                    allowEmpty={false}
                    errorMessages={hasAttemptedSubmit ? contactPhoneValidationErrors : undefined}
                    onValidationChange={setContactPhoneValidationErrors}
                  />
                </div>
              </div>
            </div>

            {/* Additional Settings */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="client-notes-input" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('quickAddClient.notes', { defaultValue: 'Notes' })}
                </Label>
                <TextArea
                  id="client-notes-input"
                  data-automation-id="client-notes-input"
                  value={formData.notes || ''}
                  onChange={(e) => handleClientChange('notes', e.target.value)}
                  onBlur={() => {
                    validateField('notes', formData.notes || '');
                  }}
                  placeholder={t('quickAddClient.notesPlaceholder', {
                    defaultValue: 'Add any initial notes (optional)',
                  })}
                  disabled={isSubmitting}
                  className={`w-full p-2 border rounded-md resize-none focus:outline-none focus:ring-2 ${fieldErrors.notes ? 'border-red-500' : 'border-gray-300'} ${fieldErrors.notes ? 'focus:ring-red-500' : 'focus:ring-purple-500'}`}
                  rows={3}
                />
                {fieldErrors.notes && (
                  <p className="text-sm text-red-600 mt-1">{fieldErrors.notes}</p>
                )}
              </div>
            </div>
          </div>
        </form>

        <DialogFooter>
          <div className="flex justify-between mt-6 w-full">
            <Button
              id="cancel-dialog-btn"
              type="button"
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => {
                setHasAttemptedSubmit(false);
                setValidationErrors([]);
                setFieldErrors({});
                onOpenChange(false);
              }}
            >
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="create-client-btn"
              type="submit"
              form="quick-add-client-form"
              disabled={isSubmitting || !formData.client_name.trim()}
              className={(!formData.client_name.trim() || Object.values(fieldErrors).some(error => error)) ? 'opacity-50' : ''}
            >
              {isSubmitting
                ? t('quickAddClient.creating', { defaultValue: 'Creating...' })
                : t('quickAddClient.createClient', { defaultValue: 'Create Client' })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ClientCreatedDialog
      isOpen={showSuccess}
      client={createdClient}
      onClose={() => setShowSuccess(false)}
      onViewClient={() => {
        if (createdClient) {
          setShowSuccess(false);
          router.push(`/msp/clients/${createdClient.client_id}`);
        }
      }}
      onAddAnother={() => {
        setShowSuccess(false);
        onOpenChange(true);
      }}
    />
    </>
  );
};

export default QuickAddClient;
