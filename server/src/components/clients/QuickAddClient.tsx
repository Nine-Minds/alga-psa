'use client'

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { IClient, IClientLocation } from 'server/src/interfaces/client.interfaces';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { Input } from 'server/src/components/ui/Input';
import { PhoneInput } from 'server/src/components/ui/PhoneInput';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { TextArea } from 'server/src/components/ui/TextArea';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogFooter
} from 'server/src/components/ui/Dialog';
import UserPicker from 'server/src/components/ui/UserPicker';
import { getAllUsers } from '@product/actions/user-actions/userActions';
import { createClient } from '@product/actions/client-actions/clientActions';
import { createClientLocation } from '@product/actions/client-actions/clientLocationActions';
import { createClientContact } from '@product/actions/contact-actions/contactActions';
import { getAllCountries, ICountry } from '@product/actions/client-actions/countryActions';
import CountryPicker from 'server/src/components/ui/CountryPicker';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import toast from 'react-hot-toast';
import ClientCreatedDialog from './ClientCreatedDialog';
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
} from 'server/src/lib/utils/clientFormValidation';

type CreateClientData = Omit<IClient, "client_id" | "created_at" | "updated_at" | "notes_document_id" | "status" | "tenant" | "deleted_at">;

type CreateLocationData = Omit<IClientLocation, "location_id" | "tenant" | "created_at" | "updated_at">;

type CreateContactData = Omit<IContact, "contact_name_id" | "tenant" | "client_id" | "created_at" | "updated_at" | "is_inactive" | "avatarUrl">;

interface QuickAddClientProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClientAdded: (client: IClient) => void;
  trigger?: React.ReactNode;
}

const QuickAddClient: React.FC<QuickAddClientProps> = ({
  open,
  onOpenChange,
  onClientAdded,
  trigger
}) => {
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
    phone_number: '',
    email: '',
    role: '',
    notes: '',
  };

  const [formData, setFormData] = useState<CreateClientData>(initialFormData);
  const [locationData, setLocationData] = useState<CreateLocationData>(initialLocationData);
  const [contactData, setContactData] = useState<CreateContactData>(initialContactData);
  const [internalUsers, setInternalUsers] = useState<IUserWithRoles[]>([]);
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
  const router = useRouter();

  useEffect(() => {
    if (open) {
      const fetchUsers = async () => {
        if (isLoadingUsers || internalUsers.length > 0) return;
        setIsLoadingUsers(true);
        try {
          const users = await getAllUsers();
          setInternalUsers(users);
        } catch (error: any) {
          console.error("Error fetching MSP users:", error);
          toast.error("Failed to load users for Account Manager selection.");
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
          console.error("Error fetching countries:", error);
          toast.error("Failed to load countries.");
        } finally {
          setIsLoadingCountries(false);
        }
      };


      fetchUsers();
      fetchCountries();
    } else {
      setFormData(initialFormData);
      setLocationData(initialLocationData);
      setContactData(initialContactData);
      setIsSubmitting(false);
      setError(null);
      setHasAttemptedSubmit(false);
      setValidationErrors([]);
      setFieldErrors({});
    }
  }, [open]);

  // Real-time field validation function
  const validateField = (fieldName: string, value: string, additionalData?: any) => {
    let error: string | null = null;
    
    // If field is empty, only validate if it's a required field
    if (!value || !value.trim()) {
      // Only client name is required, all other fields are optional
      if (fieldName === 'client_name') {
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
        error = validatePhoneNumber(value);
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
      case 'contact_phone':
        error = validatePhoneNumber(value);
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
      contactEmail: contactData.email,
      contactPhone: contactData.phone_number,
      notes: formData.notes
    });
    
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
        setError(result.error);
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
          console.error("Error creating client location:", locationError);
          toast.error("Client created but failed to add location.");
        }
      }

      // Create contact if contact data is provided
      if (contactData.full_name.trim() || contactData.email.trim()) {
        try {
          await createClientContact({
            clientId: newClient.client_id,
            fullName: contactData.full_name,
            email: contactData.email,
            phone: contactData.phone_number,
            jobTitle: contactData.role,
          });
        } catch (contactError) {
          console.error("Error creating client contact:", contactError);
          toast.error("Client created but failed to add contact.");
        }
      }


      setCreatedClient(newClient);
      setShowSuccess(true);
      onClientAdded(newClient);
      onOpenChange(false);
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
    if (fieldErrors[field]) {
      setFieldErrors(prev => ({
        ...prev,
        [field]: ''
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

  const handleContactChange = (field: keyof CreateContactData, value: string) => {
    setContactData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear errors when user starts typing
    const validationFieldMap: Record<string, string> = {
      'full_name': 'contact_name',
      'email': 'contact_email',
      'phone_number': 'contact_phone'
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


  return (
    <>
    <Dialog
      id="quick-add-client-dialog"
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Add New Client">
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <form onSubmit={handleSubmit} id="quick-add-client-form" noValidate>
          <div className="max-h-[60vh] overflow-y-auto px-1 py-4 space-y-6">
            
            {/* Validation Errors */}
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  <p className="font-medium mb-2">Please correct the following errors:</p>
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
                Client Details
              </h3>
              
              <div>
                <Label htmlFor="client_name" className="block text-sm font-medium text-gray-700 mb-1">
                  Client Name *
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
                  placeholder="Enter client name"
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
                    Client Type
                  </Label>
                  <CustomSelect
                    id="client-type-select"
                    data-automation-id="client-type-select"
                    options={[
                      { value: 'company', label: 'Company' },
                      { value: 'individual', label: 'Individual' }
                    ]}
                    value={formData.client_type}
                    onValueChange={(value) => handleClientChange('client_type', value)}
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <Label htmlFor="industry" className="block text-sm font-medium text-gray-700 mb-1">
                    Industry
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
                    Website URL
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
                    Account Manager
                  </Label>
                  <UserPicker
                    id="account-manager-picker"
                    data-automation-id="account-manager-picker"
                    value={formData.account_manager_id || ''}
                    onValueChange={(value) => handleClientChange('account_manager_id', value)}
                    users={internalUsers}
                    disabled={isLoadingUsers || isSubmitting}
                    placeholder={isLoadingUsers ? "Loading users..." : "Select Account Manager"}
                    buttonWidth="full"
                  />
                </div>
              </div>
            </div>

            {/* Client Location Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Client Location
              </h3>
              
              <div>
                <Label htmlFor="address-line-1" className="block text-sm font-medium text-gray-700 mb-1">
                  Street Address
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
                    City
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
                    State
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
                    Zip Code
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
                    Country
                  </Label>
                  <CountryPicker
                    id="country-picker"
                    data-automation-id="country-picker"
                    value={locationData.country_code}
                    onValueChange={handleCountryChange}
                    countries={countries}
                    disabled={isLoadingCountries || isSubmitting}
                    placeholder={isLoadingCountries ? "Loading countries..." : "Select Country"}
                    buttonWidth="full"
                  />
                </div>

                <div>
                  <PhoneInput
                    id="client-location-phone"
                    label="Phone"
                    value={locationData.phone || ''}
                    onChange={(value) => handleLocationChange('phone', value)}
                    onBlur={() => {
                      validateField('location_phone', locationData.phone || '');
                    }}
                    countryCode={locationData.country_code}
                    phoneCode={countries.find(c => c.code === locationData.country_code)?.phone_code}
                    disabled={isSubmitting}
                    data-automation-id="client-location-phone"
                  />
                  {fieldErrors.location_phone && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.location_phone}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="client-location-email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </Label>
                  <Input
                    id="client-location-email"
                    data-automation-id="client-location-email"
                    type="email"
                    value={locationData.email || ''}
                    onChange={(e) => handleLocationChange('email', e.target.value)}
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
                Contact Information
              </h3>
              
              <div>
                <Label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name
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
                    Email
                  </Label>
                  <Input
                    id="client-contact-email"
                    data-automation-id="client-contact-email"
                    type="email"
                    value={contactData.email}
                    onChange={(e) => handleContactChange('email', e.target.value)}
                    onBlur={() => {
                      validateField('contact_email', contactData.email);
                    }}
                    disabled={isSubmitting}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.contact_email ? 'border-red-500' : 'border-gray-300'}`}
                  />
                  {fieldErrors.contact_email && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.contact_email}</p>
                  )}
                </div>

                <div>
                  <PhoneInput
                    id="client-contact-phone"
                    label="Phone"
                    value={contactData.phone_number}
                    onChange={(value) => handleContactChange('phone_number', value)}
                    onBlur={() => {
                      validateField('contact_phone', contactData.phone_number);
                    }}
                    countryCode={locationData.country_code}
                    phoneCode={countries.find(c => c.code === locationData.country_code)?.phone_code}
                    disabled={isSubmitting}
                    data-automation-id="client-contact-phone"
                  />
                  {fieldErrors.contact_phone && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.contact_phone}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Additional Settings */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="client-notes-input" className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </Label>
                <TextArea
                  id="client-notes-input"
                  data-automation-id="client-notes-input"
                  value={formData.notes || ''}
                  onChange={(e) => handleClientChange('notes', e.target.value)}
                  onBlur={() => {
                    validateField('notes', formData.notes || '');
                  }}
                  placeholder="Add any initial notes (optional)"
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
              Cancel
            </Button>
            <Button
              id="create-client-btn"
              type="submit"
              form="quick-add-client-form"
              disabled={isSubmitting || !formData.client_name.trim()}
              className={(!formData.client_name.trim() || Object.values(fieldErrors).some(error => error)) ? 'opacity-50' : ''}
            >
              {isSubmitting ? 'Creating...' : 'Create Client'}
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
