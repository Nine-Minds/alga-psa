'use client'

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ICompany, ICompanyLocation } from 'server/src/interfaces/company.interfaces';
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
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { createCompany } from 'server/src/lib/actions/company-actions/companyActions';
import { createCompanyLocation } from 'server/src/lib/actions/company-actions/companyLocationActions';
import { createCompanyContact } from 'server/src/lib/actions/contact-actions/contactActions';
import { getAllCountries, ICountry } from 'server/src/lib/actions/company-actions/countryActions';
import CountryPicker from 'server/src/components/ui/CountryPicker';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import toast from 'react-hot-toast';
import ClientCreatedDialog from './ClientCreatedDialog';
import { 
  validateClientForm, 
  validateCompanyName, 
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

type CreateCompanyData = Omit<ICompany, "company_id" | "created_at" | "updated_at" | "notes_document_id" | "status" | "tenant" | "deleted_at">;

type CreateLocationData = Omit<ICompanyLocation, "location_id" | "tenant" | "created_at" | "updated_at">;

type CreateContactData = Omit<IContact, "contact_name_id" | "tenant" | "company_id" | "created_at" | "updated_at" | "is_inactive" | "avatarUrl">;

interface QuickAddCompanyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompanyAdded: (company: ICompany) => void;
  trigger?: React.ReactNode;
}

const QuickAddCompany: React.FC<QuickAddCompanyProps> = ({
  open,
  onOpenChange,
  onCompanyAdded,
  trigger
}) => {
  const initialFormData: CreateCompanyData = {
    company_name: '',
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
    company_id: '',
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

  // Separate country code state for contact phone (independent from location)
  const [contactCountryCode, setContactCountryCode] = useState(() => {
    // Default to same locale detection as other forms
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      const parts = locale.split('-');
      const detectedCountry = parts[parts.length - 1]?.toUpperCase();
      return detectedCountry && detectedCountry.length === 2 && /^[A-Z]{2}$/.test(detectedCountry) ? detectedCountry : 'US';
    } catch (e) {
      return 'US';
    }
  });

  const [formData, setFormData] = useState<CreateCompanyData>(initialFormData);
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
  const [createdCompany, setCreatedCompany] = useState<ICompany | null>(null);
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
      setContactCountryCode(() => {
        // Reset to locale detection
        try {
          const locale = Intl.DateTimeFormat().resolvedOptions().locale;
          const parts = locale.split('-');
          const detectedCountry = parts[parts.length - 1]?.toUpperCase();
          return detectedCountry && detectedCountry.length === 2 && /^[A-Z]{2}$/.test(detectedCountry) ? detectedCountry : 'US';
        } catch (e) {
          return 'US';
        }
      });
      setIsSubmitting(false);
      setError(null);
      setHasAttemptedSubmit(false);
      setValidationErrors([]);
      setFieldErrors({});
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
      if (fieldName === 'company_name' && isSubmitting) {
        error = 'Please enter a company name to continue';
      }
      // For optional fields, clear any existing errors when empty
      setFieldErrors(prev => ({
        ...prev,
        [fieldName]: ''
      }));
      return error;
    }
    
    switch (fieldName) {
      case 'company_name':
        error = validateCompanyName(value);
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

    // Professional SaaS validation - only essential fields and fields with content
    const fieldValidationErrors: Record<string, string> = {};
    const validationMessages: string[] = [];

    // Essential field validation
    const companyNameError = validateCompanyName(formData.company_name);
    if (companyNameError) {
      fieldValidationErrors.company_name = companyNameError;
      validationMessages.push(companyNameError);
    }

    // Primary Contact Name - Required
    const contactNameError = validateContactName(contactData.full_name);
    if (contactNameError) {
      fieldValidationErrors.contact_name = contactNameError;
      validationMessages.push(contactNameError);
    }

    // Primary Contact Email - Required
    const contactEmailError = validateEmailAddress(contactData.email);
    if (contactEmailError) {
      fieldValidationErrors.contact_email = contactEmailError;
      validationMessages.push(contactEmailError);
    }

    // Account Manager is optional - UserPicker has "Not assigned" option

    // Optional fields - only validate if they have content
    if (formData.url && formData.url.trim()) {
      const urlError = validateWebsiteUrl(formData.url);
      if (urlError) {
        fieldValidationErrors.url = urlError;
        validationMessages.push(urlError);
      }
    }

    if (formData.properties?.industry && formData.properties.industry.trim()) {
      const industryError = validateIndustry(formData.properties.industry);
      if (industryError) {
        fieldValidationErrors.industry = industryError;
        validationMessages.push(industryError);
      }
    }

    if (locationData.email && locationData.email.trim()) {
      const emailError = validateEmailAddress(locationData.email);
      if (emailError) {
        fieldValidationErrors.location_email = emailError;
        validationMessages.push(emailError);
      }
    }

    if (locationData.phone && locationData.phone.trim()) {
      const phoneError = validatePhoneNumber(locationData.phone);
      if (phoneError) {
        fieldValidationErrors.location_phone = phoneError;
        validationMessages.push(phoneError);
      }
    }

    if (locationData.address_line1 && locationData.address_line1.trim()) {
      const addressError = validateAddress(locationData.address_line1);
      if (addressError) {
        fieldValidationErrors.address_line1 = addressError;
        validationMessages.push(addressError);
      }
    }

    if (locationData.city && locationData.city.trim()) {
      const cityError = validateCityName(locationData.city);
      if (cityError) {
        fieldValidationErrors.city = cityError;
        validationMessages.push(cityError);
      }
    }

    if (locationData.state_province && locationData.state_province.trim()) {
      const stateError = validateStateProvince(locationData.state_province);
      if (stateError) {
        fieldValidationErrors.state_province = stateError;
        validationMessages.push(stateError);
      }
    }

    if (locationData.postal_code && locationData.postal_code.trim()) {
      const postalError = validatePostalCode(locationData.postal_code, locationData.country_code);
      if (postalError) {
        fieldValidationErrors.postal_code = postalError;
        validationMessages.push(postalError);
      }
    }

    // Contact name and email are now required fields - validation moved to Essential field validation section above

    if (contactData.phone_number && contactData.phone_number.trim()) {
      const contactPhoneError = validatePhoneNumber(contactData.phone_number);
      if (contactPhoneError) {
        fieldValidationErrors.contact_phone = contactPhoneError;
        validationMessages.push(contactPhoneError);
      }
    }

    if (formData.notes && formData.notes.trim()) {
      const notesError = validateNotes(formData.notes);
      if (notesError) {
        fieldValidationErrors.notes = notesError;
        validationMessages.push(notesError);
      }
    }

    // Only block submission if there are validation errors
    if (validationMessages.length > 0) {
      setFieldErrors(fieldValidationErrors);
      setValidationErrors(validationMessages);
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

      const result = await createCompany(dataToSend);

      if (!result.success) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }

      const newCompany = result.data;

      // Create location if any location data is provided (address, city, phone, or email)
      // Check if phone has actual number, not just country code
      const phoneCode = countries.find(c => c.code === locationData.country_code)?.phone_code || '';
      const hasActualPhone = locationData.phone?.trim() && 
                            locationData.phone.trim() !== phoneCode &&
                            locationData.phone.replace(/\s+/g, '').length > phoneCode.length;
      
      if (locationData.address_line1.trim() || locationData.city.trim() || 
          hasActualPhone || locationData.email?.trim()) {
        try {
          await createCompanyLocation(newCompany.company_id, locationData);
        } catch (locationError) {
          console.error("Error creating company location:", locationError);
          toast.error("Company created but failed to add location.");
        }
      }

      // Create contact if contact data is provided
      if (contactData.full_name.trim() || contactData.email.trim()) {
        try {
          await createCompanyContact({
            companyId: newCompany.company_id,
            fullName: contactData.full_name,
            email: contactData.email,
            phone: contactData.phone_number,
            jobTitle: contactData.role,
          });
        } catch (contactError) {
          console.error("Error creating company contact:", contactError);
          toast.error("Company created but failed to add contact.");
        }
      }


      setCreatedCompany(newCompany);
      setShowSuccess(true);
      onCompanyAdded(newCompany);
      onOpenChange(false);
      } catch (error: any) {
      console.error("Error creating company:", error);
      const errorMessage = error.message || "Failed to create company. Please try again.";
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };


  const handleCompanyChange = (field: string, value: string | boolean | null) => {
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

  const handleContactCountryChange = (countryCode: string) => {
    setContactCountryCode(countryCode);
  };

  // Professional SaaS form validation - only essential fields required (Microsoft/Meta standard)
  const isFormValid = () => {
    // Only required field: Company name (essential for business identification)
    if (!formData.company_name || !formData.company_name.trim()) {
      return false;
    }

    // Company name must be valid if provided
    const companyNameError = validateCompanyName(formData.company_name);
    if (companyNameError) return false;

    // All other fields are optional - user can submit with just company name
    // This follows Microsoft/SaaS pattern where users aren't blocked from proceeding
    // Field validation errors only prevent submission if there are actual validation issues with provided content

    // Check for any existing field errors (but only for fields that have content)
    const relevantErrors = Object.entries(fieldErrors).filter(([fieldName, error]) => {
      if (!error || error.trim() === '') return false;

      // Only consider errors for fields that actually have content
      switch (fieldName) {
        case 'url': return formData.url && formData.url.trim();
        case 'industry': return formData.properties?.industry && formData.properties.industry.trim();
        case 'location_email': return locationData.email && locationData.email.trim();
        case 'location_phone': return locationData.phone && locationData.phone.trim();
        case 'postal_code': return locationData.postal_code && locationData.postal_code.trim();
        case 'city': return locationData.city && locationData.city.trim();
        case 'state_province': return locationData.state_province && locationData.state_province.trim();
        case 'address_line1': return locationData.address_line1 && locationData.address_line1.trim();
        case 'contact_name': return contactData.full_name && contactData.full_name.trim();
        case 'contact_email': return contactData.email && contactData.email.trim();
        case 'contact_phone': return contactData.phone_number && contactData.phone_number.trim();
        case 'notes': return formData.notes && formData.notes.trim();
        default: return true; // For unknown fields, consider errors
      }
    });

    // Only block submission if there are validation errors for fields with content
    return relevantErrors.length === 0;
  };


  return (
    <>
    <Dialog
      id="quick-add-company-dialog"
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Add New Client">
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <form onSubmit={handleSubmit} id="quick-add-company-form" noValidate>
          <div className="max-h-[60vh] overflow-y-auto px-1 py-4 space-y-6">
            
            {/* Removed top validation errors - now showing inline near action button */}
            
            {/* Error Alert */}
            {error && (
              <Alert variant="destructive" data-automation-id="company-creation-error-alert">
                <AlertDescription>
                  {error}
                </AlertDescription>
              </Alert>
            )}
            
            {/* Company Details Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Client Details
              </h3>
              
              <div>
                <Label htmlFor="company_name" className="block text-sm font-medium text-gray-700 mb-1">
                  Client Name *
                </Label>
                <Input
                  id="company-name"
                  data-automation-id="company-name-input"
                  value={formData.company_name}
                  onChange={(e) => {
                    handleCompanyChange('company_name', e.target.value);
                  }}
                  onBlur={() => {
                    validateField('company_name', formData.company_name);
                  }}
                  placeholder="Enter client name"
                  disabled={isSubmitting}
                  className={`w-full text-lg font-semibold p-2 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 ${fieldErrors.company_name ? 'border-red-500' : 'border-gray-300'}`}
                />
                {fieldErrors.company_name && (
                  <p className="text-sm text-red-600 mt-1">{fieldErrors.company_name}</p>
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
                    onValueChange={(value) => handleCompanyChange('client_type', value)}
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <Label htmlFor="industry" className="block text-sm font-medium text-gray-700 mb-1">
                    Industry (optional)
                  </Label>
                  <Input
                    id="industry"
                    data-automation-id="industry"
                    value={formData.properties?.industry || ''}
                    onChange={(e) => {
                      handleCompanyChange('properties.industry', e.target.value);
                      // Professional SaaS approach: Clear errors while typing, don't show new ones
                      setFieldErrors(prev => ({ ...prev, industry: '' }));
                    }}
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
                    Website URL (optional)
                  </Label>
                  <Input
                    id="url"
                    data-automation-id="url"
                    value={formData.url}
                    onChange={(e) => handleCompanyChange('url', e.target.value)}
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
                    Account Manager (optional)
                  </Label>
                  <UserPicker
                    id="account-manager-picker"
                    data-automation-id="account-manager-picker"
                    value={formData.account_manager_id || ''}
                    onValueChange={(value) => handleCompanyChange('account_manager_id', value)}
                    users={internalUsers}
                    disabled={isLoadingUsers || isSubmitting}
                    placeholder={isLoadingUsers ? "Loading users..." : "Select Account Manager"}
                    buttonWidth="full"
                  />
                  {fieldErrors.account_manager && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.account_manager}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Company Location Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Client Location
              </h3>
              
              <div>
                <Label htmlFor="address-line-1" className="block text-sm font-medium text-gray-700 mb-1">
                  Street Address (optional)
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
                    City (optional)
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
                    State (optional)
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
                  <Label htmlFor="company-postal-code" className="block text-sm font-medium text-gray-700 mb-1">
                    Zip Code (optional)
                  </Label>
                  <Input
                    id="company-postal-code"
                    data-automation-id="company-postal-code"
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
              </div>

              <div className="grid grid-cols-3 gap-4">
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
                    id="company-location-phone"
                    label="Phone (optional)"
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
                    disabled={isSubmitting}
                    error={!!fieldErrors.location_phone}
                    data-automation-id="company-location-phone"
                  />
                  {fieldErrors.location_phone && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.location_phone}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="company-location-email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email (optional)
                  </Label>
                  <Input
                    id="company-location-email"
                    data-automation-id="company-location-email"
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
                Contact Information
              </h3>
              
              <div>
                <Label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Primary Contact Name *
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
                  <Label htmlFor="company-contact-email" className="block text-sm font-medium text-gray-700 mb-1">
                    Primary Contact Email *
                  </Label>
                  <Input
                    id="company-contact-email"
                    data-automation-id="company-contact-email"
                    type="email"
                    value={contactData.email}
                    onChange={(e) => {
                      handleContactChange('email', e.target.value);
                      // Immediately validate if user enters only spaces
                      if (/^\s+$/.test(e.target.value)) {
                        setFieldErrors(prev => ({ ...prev, contact_email: 'Email address cannot contain only spaces' }));
                      }
                    }}
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
                    id="company-contact-phone"
                    label="Phone (optional)"
                    value={contactData.phone_number}
                    onChange={(value) => {
                      handleContactChange('phone_number', value);
                      // Clear error when user starts typing, clears the field, or has only country code
                      const trimmedValue = value.trim();
                      const isCountryCodeOnly = /^\+\d{1,4}\s*$/.test(trimmedValue);

                      if (fieldErrors.contact_phone && (trimmedValue === '' || isCountryCodeOnly)) {
                        setFieldErrors(prev => ({ ...prev, contact_phone: '' }));
                      }
                    }}
                    onBlur={() => {
                      validateField('contact_phone', contactData.phone_number);
                    }}
                    countryCode={contactCountryCode}
                    phoneCode={countries.find(c => c.code === contactCountryCode)?.phone_code}
                    countries={countries}
                    onCountryChange={handleContactCountryChange}
                    disabled={isSubmitting}
                    error={!!fieldErrors.contact_phone}
                    data-automation-id="company-contact-phone"
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
                <Label htmlFor="company-notes-input" className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (optional)
                </Label>
                <TextArea
                  id="company-notes-input"
                  data-automation-id="company-notes-input"
                  value={formData.notes || ''}
                  onChange={(e) => handleCompanyChange('notes', e.target.value)}
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
            <div className="flex flex-col items-end gap-2">
              {hasAttemptedSubmit && Object.keys(fieldErrors).length > 0 && (
                <p className="text-sm text-red-600 text-right">
                  Please fill in all required fields
                </p>
              )}
              <Button
                id="create-company-btn"
                type="submit"
                form="quick-add-company-form"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating...' : 'Create Client'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ClientCreatedDialog
      isOpen={showSuccess}
      company={createdCompany}
      onClose={() => setShowSuccess(false)}
      onViewClient={() => {
        if (createdCompany) {
          setShowSuccess(false);
          router.push(`/msp/companies/${createdCompany.company_id}`);
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

export default QuickAddCompany;
