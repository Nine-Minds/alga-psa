'use client'

import React, { useState, useEffect } from 'react';
import { ICompany, ICompanyLocation } from 'server/src/interfaces/company.interfaces';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { TextArea } from 'server/src/components/ui/TextArea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

type CreateCompanyData = Omit<ICompany, "company_id" | "created_at" | "updated_at" | "notes_document_id" | "status" | "tenant" | "deleted_at" | "address">;

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
    phone_no: '',
    email: '',
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
    credit_balance: 0,
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
    date_of_birth: '',
    notes: '',
  };

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

  useEffect(() => {
    if (open) {
      const fetchUsers = async () => {
        if (isLoadingUsers || internalUsers.length > 0) return;
        setIsLoadingUsers(true);
        try {
          const users = await getAllUsers();
          setInternalUsers(users);
        } catch (error: any) {
          console.error("Error fetching internal users:", error);
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
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setHasAttemptedSubmit(true);
    const errors: string[] = [];
    
    // Validate required fields
    if (!formData.company_name.trim()) {
      errors.push('Company name');
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setValidationErrors([]);
    try {
      const dataToSend = {
        ...formData,
        properties: formData.properties,
        account_manager_id: formData.account_manager_id === '' ? null : formData.account_manager_id,
      };

      const result = await createCompany(dataToSend);

      if (!result.success) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }

      const newCompany = result.data;

      // Create location if address data is provided
      if (locationData.address_line1.trim() || locationData.city.trim()) {
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

      toast.success(`Company "${newCompany.company_name}" created successfully.`);
      onCompanyAdded(newCompany);
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating company:", error);
      const errorMessage = error.message || "Failed to create company. Please try again.";
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
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
  };

  const handleLocationChange = (field: keyof CreateLocationData, value: string | boolean | null) => {
    setLocationData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleContactChange = (field: keyof CreateContactData, value: string) => {
    setContactData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCountryChange = (countryCode: string, countryName: string) => {
    setLocationData(prev => ({
      ...prev,
      country_code: countryCode,
      country_name: countryName
    }));
  };

  return (
    <Dialog
      id="quick-add-company-dialog"
      isOpen={open}
      onClose={() => onOpenChange(false)}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} id="quick-add-company-form" noValidate>
          <div className="max-h-[60vh] overflow-y-auto px-1 py-4 space-y-6">
            
            {/* Validation Errors */}
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>
                  <p className="font-medium mb-2">Please fill in the required fields:</p>
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
              <Alert variant="destructive" data-automation-id="company-creation-error-alert">
                <AlertDescription>
                  {error}
                </AlertDescription>
              </Alert>
            )}
            
            {/* Company Details Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Company Details
              </h3>
              
              <div>
                <Label htmlFor="company_name" className="block text-sm font-medium text-gray-700 mb-1">
                  Company Name *
                </Label>
                <Input
                  data-automation-id="company-name-input"
                  value={formData.company_name}
                  onChange={(e) => {
                    handleCompanyChange('company_name', e.target.value);
                    clearErrorIfSubmitted();
                  }}
                  placeholder="Enter company name"
                  disabled={isSubmitting}
                  className={`w-full text-lg font-semibold p-2 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 ${hasAttemptedSubmit && !formData.company_name.trim() ? 'border-red-500' : 'border-gray-300'}`}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="client_type_select" className="block text-sm font-medium text-gray-700 mb-1">
                    Client Type
                  </Label>
                  <CustomSelect
                    data-automation-id="client_type_select"
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
                    Industry
                  </Label>
                  <Input
                    data-automation-id="industry"
                    value={formData.properties?.industry || ''}
                    onChange={(e) => handleCompanyChange('properties.industry', e.target.value)}
                    disabled={isSubmitting}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
                    Website URL
                  </Label>
                  <Input
                    data-automation-id="url"
                    value={formData.url}
                    onChange={(e) => handleCompanyChange('url', e.target.value)}
                    placeholder="https://example.com"
                    disabled={isSubmitting}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <Label htmlFor="account_manager_picker" className="block text-sm font-medium text-gray-700 mb-1">
                    Account Manager
                  </Label>
                  <UserPicker
                    data-automation-id="account_manager_picker"
                    value={formData.account_manager_id || ''}
                    onValueChange={(value) => handleCompanyChange('account_manager_id', value)}
                    users={internalUsers}
                    disabled={isLoadingUsers || isSubmitting}
                    placeholder={isLoadingUsers ? "Loading users..." : "Select Account Manager"}
                    buttonWidth="full"
                  />
                </div>
              </div>
            </div>

            {/* Company Location Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Company Location
              </h3>
              
              <div>
                <Label htmlFor="address_line1" className="block text-sm font-medium text-gray-700 mb-1">
                  Street Address
                </Label>
                <Input
                  data-automation-id="address_line1"
                  value={locationData.address_line1}
                  onChange={(e) => handleLocationChange('address_line1', e.target.value)}
                  disabled={isSubmitting}
                  className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                    City
                  </Label>
                  <Input
                    data-automation-id="city"
                    value={locationData.city}
                    onChange={(e) => handleLocationChange('city', e.target.value)}
                    disabled={isSubmitting}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <Label htmlFor="state_province" className="block text-sm font-medium text-gray-700 mb-1">
                    State
                  </Label>
                  <Input
                    data-automation-id="state_province"
                    value={locationData.state_province || ''}
                    onChange={(e) => handleLocationChange('state_province', e.target.value)}
                    disabled={isSubmitting}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <Label htmlFor="postal_code" className="block text-sm font-medium text-gray-700 mb-1">
                    Zip Code
                  </Label>
                  <Input
                    data-automation-id="postal_code"
                    value={locationData.postal_code || ''}
                    onChange={(e) => handleLocationChange('postal_code', e.target.value)}
                    disabled={isSubmitting}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="country_picker" className="block text-sm font-medium text-gray-700 mb-1">
                  Country
                </Label>
                <CountryPicker
                  data-automation-id="country_picker"
                  value={locationData.country_code}
                  onValueChange={handleCountryChange}
                  countries={countries}
                  disabled={isLoadingCountries || isSubmitting}
                  placeholder={isLoadingCountries ? "Loading countries..." : "Select Country"}
                  buttonWidth="full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="location_phone" className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </Label>
                  <Input
                    data-automation-id="location_phone"
                    value={locationData.phone || ''}
                    onChange={(e) => handleLocationChange('phone', e.target.value)}
                    disabled={isSubmitting}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <Label htmlFor="location_email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </Label>
                  <Input
                    data-automation-id="location_email"
                    type="email"
                    value={locationData.email || ''}
                    onChange={(e) => handleLocationChange('email', e.target.value)}
                    disabled={isSubmitting}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
            </div>

            {/* Contact Information Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Contact Information
              </h3>
              
              <div>
                <Label htmlFor="contact_name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </Label>
                <Input
                  data-automation-id="contact_name"
                  value={contactData.full_name}
                  onChange={(e) => handleContactChange('full_name', e.target.value)}
                  disabled={isSubmitting}
                  className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="contact_email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </Label>
                  <Input
                    data-automation-id="contact_email"
                    type="email"
                    value={contactData.email}
                    onChange={(e) => handleContactChange('email', e.target.value)}
                    disabled={isSubmitting}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <Label htmlFor="contact_phone" className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </Label>
                  <Input
                    data-automation-id="contact_phone"
                    value={contactData.phone_number}
                    onChange={(e) => handleContactChange('phone_number', e.target.value)}
                    disabled={isSubmitting}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
            </div>

            {/* Additional Settings */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </Label>
                <TextArea
                  data-automation-id="notes"
                  value={formData.notes}
                  onChange={(e) => handleCompanyChange('notes', e.target.value)}
                  placeholder="Add any initial notes (optional)"
                  disabled={isSubmitting}
                  className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                  rows={3}
                />
              </div>
            </div>
          </div>
        </form>

        <DialogFooter>
          <div className="flex justify-between mt-6 w-full">
            <Button
              id="cancel-quick-add-company-btn"
              type="button"
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => {
                setHasAttemptedSubmit(false);
                setValidationErrors([]);
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              id="create-company-btn"
              type="submit"
              form="quick-add-company-form"
              disabled={isSubmitting}
              className={!formData.company_name.trim() ? 'opacity-50' : ''}
            >
              {isSubmitting ? 'Creating...' : 'Create Client'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QuickAddCompany;
