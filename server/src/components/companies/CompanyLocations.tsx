'use client';

import React, { useState, useEffect } from 'react';
import { ICompanyLocation } from 'server/src/interfaces/company.interfaces';
import { 
  getCompanyLocations, 
  createCompanyLocation, 
  updateCompanyLocation, 
  deleteCompanyLocation,
  setDefaultCompanyLocation 
} from 'server/src/lib/actions/company-actions/companyLocationActions';
import { getActiveTaxRegions } from 'server/src/lib/actions/taxSettingsActions';
import { getAllCountries, ICountry } from 'server/src/lib/actions/company-actions/countryActions';
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces';
import CountryPicker from 'server/src/components/ui/CountryPicker';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { PhoneInput } from 'server/src/components/ui/PhoneInput';
import { Label } from 'server/src/components/ui/Label';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Plus, Edit2, Trash2, MapPin, Star } from 'lucide-react';
import { useToast } from 'server/src/hooks/use-toast';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ReflectionParentContext } from 'server/src/types/ui-reflection/ReflectionParentContext';
import { DialogComponent, FormFieldComponent } from 'server/src/types/ui-reflection/types';

interface CompanyLocationsProps {
  companyId: string;
  isEditing: boolean;
}

/**
 * Sanitizes a string to be used as a valid HTML ID or data-automation-id
 * Removes or replaces characters that are invalid in HTML IDs
 * @param input - The input string to sanitize
 * @returns A sanitized string safe for use as HTML ID
 */
const sanitizeIdString = (input: string): string => {
  return input
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove all special characters except spaces and hyphens
    .replace(/\s+/g, '-')             // Replace spaces with hyphens
    .replace(/-+/g, '-')              // Replace multiple consecutive hyphens with single hyphen
    .replace(/^-|-$/g, '');           // Remove leading/trailing hyphens
};

interface LocationFormData {
  location_name: string;
  address_line1: string;
  address_line2: string;
  address_line3: string;
  city: string;
  state_province: string;
  postal_code: string;
  country_code: string;
  country_name: string;
  region_code: string | null;
  phone: string;
  fax: string;
  email: string;
  notes: string;
  is_billing_address: boolean;
  is_shipping_address: boolean;
  is_default: boolean;
}

interface LocationCardProps {
  location: ICompanyLocation;
  onEdit: (location: ICompanyLocation) => void;
  onDelete: (locationId: string) => void;
  onSetDefault: (locationId: string) => void;
  formatAddress: (location: ICompanyLocation) => string;
  showActions?: boolean;
}

// Component for individual location detail fields that registers within the proper parent context
const LocationDetailField: React.FC<{
  id: string;
  label: string;
  value: string;
  helperText: string;
  children: React.ReactNode;
}> = ({ id, label, value, helperText, children }) => {
  const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id,
    type: 'formField',
    fieldType: 'textField',
    label,
    value,
    helperText
  });

  return <div {...automationIdProps}>{children}</div>;
};

const LocationCard: React.FC<LocationCardProps> = ({ location, onEdit, onDelete, onSetDefault, formatAddress, showActions = true }) => {

  return (
    <ReflectionContainer 
      id={`location-card-${location.location_name ? sanitizeIdString(location.location_name) : location.location_id}`}
      label={location.location_name || 'Unnamed Location'}
    >
      <Card className="relative">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {location.location_name || 'Unnamed Location'}
              {location.is_default && (
                <Star className="h-4 w-4 text-yellow-500 fill-current" />
              )}
            </CardTitle>
            
            {showActions && (
              <div className="flex gap-2">
                {!location.is_default && (
                  <Button
                    id={`set-default-location-${location.location_id}-button`}
                    data-automation-id={`set-default-location-${location.location_name ? sanitizeIdString(location.location_name) : location.location_id}-button`}
                    variant="ghost"
                    size="sm"
                    onClick={() => onSetDefault(location.location_id)}
                    title="Set as default"
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                )}
                
                <Button
                  id={`edit-location-${location.location_id}-button`}
                  data-automation-id={`edit-location-${location.location_name ? sanitizeIdString(location.location_name) : location.location_id}-button`}
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(location)}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
                
                <Button
                  id={`delete-location-${location.location_id}-button`}
                  data-automation-id={`delete-location-${location.location_name ? sanitizeIdString(location.location_name) : location.location_id}-button`}
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(location.location_id)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        
        <CardContent className="pt-0">
          <div className="text-sm text-gray-600">
            <LocationDetailField
              id={`address-display-${location.location_name ? sanitizeIdString(location.location_name) : location.location_id}`}
              label="Address"
              value={formatAddress(location)}
              helperText="Full address for this location"
            >
              {formatAddress(location)}
            </LocationDetailField>
            
            {location.phone && (
              <LocationDetailField
                id={`phone-display-${location.location_name ? sanitizeIdString(location.location_name) : location.location_id}`}
                label="Phone"
                value={location.phone}
                helperText="Phone number for this location"
              >
                <div className="mt-1">Phone: {location.phone}</div>
              </LocationDetailField>
            )}
            
            {location.email && (
              <LocationDetailField
                id={`email-display-${location.location_name ? sanitizeIdString(location.location_name) : location.location_id}`}
                label="Email"
                value={location.email}
                helperText="Email address for this location"
              >
                Email: {location.email}
              </LocationDetailField>
            )}
            
            <div className="flex gap-4 mt-2">
              {location.is_billing_address && (
                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                  Billing
                </span>
              )}
              {location.is_shipping_address && (
                <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                  Shipping
                </span>
              )}
            </div>
            
            {location.notes && (
              <LocationDetailField
                id={`notes-display-${location.location_name ? sanitizeIdString(location.location_name) : location.location_id}`}
                label="Notes"
                value={location.notes}
                helperText="Additional notes for this location"
              >
                <div className="mt-2 text-xs text-gray-500">
                  {location.notes}
                </div>
              </LocationDetailField>
            )}
          </div>
        </CardContent>
      </Card>
    </ReflectionContainer>
  );
};

const initialFormData: LocationFormData = {
  location_name: '',
  address_line1: '',
  address_line2: '',
  address_line3: '',
  city: '',
  state_province: '',
  postal_code: '',
  country_code: 'US',
  country_name: 'United States',
  region_code: null,
  phone: '',
  fax: '',
  email: '',
  notes: '',
  is_billing_address: false,
  is_shipping_address: false,
  is_default: false
};

export default function CompanyLocations({ companyId, isEditing }: CompanyLocationsProps) {
  const [locations, setLocations] = useState<ICompanyLocation[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<ICompanyLocation | null>(null);
  const [formData, setFormData] = useState<LocationFormData>(initialFormData);
  const [isLoading, setIsLoading] = useState(false);
  const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]);
  const [countries, setCountries] = useState<ICountry[]>([]);
  const [isLoadingCountries, setIsLoadingCountries] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<ICompanyLocation | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const { toast } = useToast();


  useEffect(() => {
    loadLocations();
    loadTaxRegions();
    loadCountries();
  }, [companyId]);

  const loadTaxRegions = async () => {
    try {
      const regions = await getActiveTaxRegions();
      setTaxRegions(regions);
    } catch (error) {
      console.error('Error loading tax regions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load tax regions',
        variant: 'destructive',
      });
    }
  };

  const loadCountries = async () => {
    if (isLoadingCountries || countries.length > 0) return;
    setIsLoadingCountries(true);
    try {
      const countriesData = await getAllCountries();
      setCountries(countriesData);
    } catch (error) {
      console.error('Error loading countries:', error);
      toast({
        title: 'Error',
        description: 'Failed to load countries',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingCountries(false);
    }
  };

  const loadLocations = async () => {
    try {
      const fetchedLocations = await getCompanyLocations(companyId);
      setLocations(fetchedLocations);
    } catch (error) {
      console.error('Error loading locations:', error);
      toast({
        title: 'Error',
        description: 'Failed to load company locations',
        variant: 'destructive',
      });
    }
  };

  const handleAddLocation = () => {
    setEditingLocation(null);
    setFormData({
      ...initialFormData,
      is_default: locations.length === 0 // First location should be default
    });
    setIsDialogOpen(true);
    setHasAttemptedSubmit(false);
    setValidationErrors([]);
  };

  const handleEditLocation = (location: ICompanyLocation) => {
    setEditingLocation(location);
    setFormData({
      location_name: location.location_name || '',
      address_line1: location.address_line1,
      address_line2: location.address_line2 || '',
      address_line3: location.address_line3 || '',
      city: location.city,
      state_province: location.state_province || '',
      postal_code: location.postal_code || '',
      country_code: location.country_code,
      country_name: location.country_name,
      region_code: location.region_code || null,
      phone: location.phone || '',
      fax: location.fax || '',
      email: location.email || '',
      notes: location.notes || '',
      is_billing_address: location.is_billing_address || false,
      is_shipping_address: location.is_shipping_address || false,
      is_default: location.is_default || false
    });
    setIsDialogOpen(true);
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSaveLocation = async () => {
    setHasAttemptedSubmit(true);
    const errors: string[] = [];
    
    // Validate required fields
    if (!formData.address_line1.trim()) {
      errors.push('Address Line 1');
    }
    if (!formData.city.trim()) {
      errors.push('City');
    }
    if (!formData.country_code || !formData.country_name) {
      errors.push('Country');
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    setIsLoading(true);
    setValidationErrors([]);
    try {
      // Prepare the data, converting empty strings to null for region_code
      const locationData = {
        ...formData,
        region_code: formData.region_code && formData.region_code.trim() !== '' ? formData.region_code : null,
        company_id: companyId
      };

      if (editingLocation) {
        const { company_id, ...updateData } = locationData;
        await updateCompanyLocation(editingLocation.location_id, updateData);
        toast({
          title: 'Success',
          description: 'Location updated successfully',
        });
      } else {
        await createCompanyLocation(companyId, locationData);
        toast({
          title: 'Success',
          description: 'Location created successfully',
        });
      }
      
      setIsDialogOpen(false);
      await loadLocations();
    } catch (error) {
      console.error('Error saving location:', error);
      toast({
        title: 'Error',
        description: 'Failed to save location',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    const location = locations.find(loc => loc.location_id === locationId);
    if (!location) return;
    
    setLocationToDelete(location);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteLocation = async () => {
    if (!locationToDelete) return;

    try {
      await deleteCompanyLocation(locationToDelete.location_id);
      toast({
        title: 'Success',
        description: 'Location deleted successfully',
      });
      await loadLocations();
    } catch (error) {
      console.error('Error deleting location:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete location',
        variant: 'destructive',
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setLocationToDelete(null);
    }
  };

  const handleSetDefault = async (locationId: string) => {
    try {
      await setDefaultCompanyLocation(locationId);
      toast({
        title: 'Success',
        description: 'Default location updated',
      });
      await loadLocations();
    } catch (error) {
      console.error('Error setting default location:', error);
      toast({
        title: 'Error',
        description: 'Failed to set default location',
        variant: 'destructive',
      });
    }
  };

  const handleCountryChange = (countryCode: string, countryName: string) => {
    setFormData(prev => ({
      ...prev,
      country_code: countryCode,
      country_name: countryName
    }));
  };

  const formatAddress = (location: ICompanyLocation) => {
    const addressParts = [];
    
    // Combine address lines (address_line1, address_line2, address_line3)
    const addressLines = [
      location.address_line1,
      location.address_line2,
      location.address_line3
    ].filter(Boolean);
    
    if (addressLines.length > 0) {
      addressParts.push(addressLines.join(', '));
    }
    
    // Add city if present
    if (location.city) {
      addressParts.push(location.city);
    }
    
    // Add state/province and postal code together (space-separated, not comma-separated)
    const statePostalParts = [];
    if (location.state_province) {
      statePostalParts.push(location.state_province);
    }
    if (location.postal_code) {
      statePostalParts.push(location.postal_code);
    }
    if (statePostalParts.length > 0) {
      addressParts.push(statePostalParts.join(' '));
    }
    
    // Add country if present
    if (location.country_name) {
      addressParts.push(location.country_name);
    }
    
    // Join all major address components with comma-space
    return addressParts.join(', ');
  };

  // Read-only mode - show default location card or "No locations"
  if (!isEditing) {
    const defaultLocation = locations.find(loc => loc.is_default);
    if (defaultLocation) {
      return (
        <LocationCard
          location={defaultLocation}
          onEdit={() => {}} // No-op in read-only mode
          onDelete={() => {}} // No-op in read-only mode
          onSetDefault={() => {}} // No-op in read-only mode
          formatAddress={formatAddress}
          showActions={false}
        />
      );
    }
    return (
      <div className="text-center py-4 text-gray-500">
        <MapPin className="h-8 w-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm">No locations added yet</p>
      </div>
    );
  }

  // Editing mode - show full management interface
  return (
    <ReflectionContainer id="company-locations-manager" label="Company Locations Manager">
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Locations</h3>
          <Button 
            id="add-company-location-button"
            variant="default"
            data-automation-id="add-company-location-button"
            onClick={handleAddLocation} 
            size="sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Location
          </Button>
        </div>
      </div>
      {/* Location Form Dialog */}
      <Dialog 
        id="company-location-dialog"
        isOpen={isDialogOpen} 
        onClose={() => {
          setIsDialogOpen(false);
          setHasAttemptedSubmit(false);
          setValidationErrors([]);
        }}
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        title={editingLocation ? 'Edit Location' : 'Add New Location'}
      >
        <DialogContent>
          
          <form onSubmit={(e) => { e.preventDefault(); handleSaveLocation(); }} className="space-y-4" noValidate>
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
            <div {...(() => {
              const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                id: 'location-name-field',
                type: 'formField',
                fieldType: 'textField',
                label: 'Location Name',
                value: formData.location_name,
                helperText: 'Name for this location (e.g., Main Office, Warehouse)'
              });
              return automationIdProps;
            })()}>
              <Label htmlFor="location-name-input">Location Name</Label>
              <Input
                id="location-name-input"
                value={formData.location_name}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, location_name: e.target.value }));
                  clearErrorIfSubmitted();
                }}
                placeholder="e.g., Main Office, Warehouse"
              />
            </div>
            
            <div {...(() => {
              const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                id: 'address-line1-field',
                type: 'formField',
                fieldType: 'textField',
                label: 'Address Line 1',
                value: formData.address_line1,
                helperText: 'Primary address line (required)'
              });
              return automationIdProps;
            })()}>
              <Label htmlFor="address-line1-input">Address Line 1 *</Label>
              <Input
                id="address-line1-input"
                value={formData.address_line1}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, address_line1: e.target.value }));
                  clearErrorIfSubmitted();
                }}
                placeholder="Enter address *"
                className={hasAttemptedSubmit && !formData.address_line1.trim() ? 'border-red-500' : ''}
                required
              />
            </div>
            
            <div {...(() => {
              const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                id: 'address-line2-field',
                type: 'formField',
                fieldType: 'textField',
                label: 'Address Line 2',
                value: formData.address_line2,
                helperText: 'Additional address information (optional)'
              });
              return automationIdProps;
            })()}>
              <Label htmlFor="address-line2-input">Address Line 2</Label>
              <Input
                id="address-line2-input"
                value={formData.address_line2}
                onChange={(e) => setFormData(prev => ({ ...prev, address_line2: e.target.value }))}
              />
            </div>
            
            <div>
              <Label htmlFor="address-line3-input">Address Line 3</Label>
              <Input
                id="address-line3-input"
                value={formData.address_line3}
                onChange={(e) => setFormData(prev => ({ ...prev, address_line3: e.target.value }))}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div {...(() => {
                const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                  id: 'city-field',
                  type: 'formField',
                  fieldType: 'textField',
                  label: 'City',
                  value: formData.city,
                  helperText: 'City name (required)'
                });
                return automationIdProps;
              })()}>
                <Label htmlFor="city-input">City *</Label>
                <Input
                  id="city-input"
                  value={formData.city}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, city: e.target.value }));
                    clearErrorIfSubmitted();
                  }}
                  placeholder="Enter city *"
                  className={hasAttemptedSubmit && !formData.city.trim() ? 'border-red-500' : ''}
                  required
                />
              </div>
              
              <div {...(() => {
                const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                  id: 'state-province-field',
                  type: 'formField',
                  fieldType: 'textField',
                  label: 'State/Province',
                  value: formData.state_province,
                  helperText: 'State or province name'
                });
                return automationIdProps;
              })()}>
                <Label htmlFor="state-province-input">State/Province</Label>
                <Input
                  id="state-province-input"
                  value={formData.state_province}
                  onChange={(e) => setFormData(prev => ({ ...prev, state_province: e.target.value }))}
                />
              </div>
              
              <div {...(() => {
                const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                  id: 'postal-code-field',
                  type: 'formField',
                  fieldType: 'textField',
                  label: 'Postal Code',
                  value: formData.postal_code,
                  helperText: 'ZIP or postal code'
                });
                return automationIdProps;
              })()}>
                <Label htmlFor="postal-code-input">Postal Code</Label>
                <Input
                  id="postal-code-input"
                  value={formData.postal_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, postal_code: e.target.value }))}
                />
              </div>
              
              <div {...(() => {
                const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                  id: 'country-picker-field',
                  type: 'formField',
                  fieldType: 'select',
                  label: 'Country',
                  value: formData.country_code,
                  helperText: 'Select country (required)'
                });
                return automationIdProps;
              })()}>
                <Label htmlFor="country-picker">Country *</Label>
                <div className={hasAttemptedSubmit && (!formData.country_code || !formData.country_name) ? 'ring-1 ring-red-500 rounded-lg' : ''}>
                  <CountryPicker
                    data-automation-id="country-picker"
                    value={formData.country_code}
                    onValueChange={(code, name) => {
                      handleCountryChange(code, name);
                      clearErrorIfSubmitted();
                    }}
                    countries={countries}
                    disabled={isLoadingCountries || isLoading}
                    placeholder={isLoadingCountries ? "Loading countries..." : "Select Country *"}
                    buttonWidth="full"
                  />
                </div>
              </div>
              
              <div {...(() => {
                const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                  id: 'phone-field',
                  type: 'formField',
                  fieldType: 'textField',
                  label: 'Phone',
                  value: formData.phone,
                  helperText: 'Phone number for this location'
                });
                return automationIdProps;
              })()}>
                <PhoneInput
                  label="Phone"
                  value={formData.phone || ''}
                  onChange={(value) => setFormData(prev => ({ ...prev, phone: value }))}
                  countryCode={formData.country_code}
                  phoneCode={countries.find(c => c.code === formData.country_code)?.phone_code}
                  data-automation-id="phone-input"
                />
              </div>
              
              <div {...(() => {
                const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                  id: 'email-field',
                  type: 'formField',
                  fieldType: 'textField',
                  label: 'Email',
                  value: formData.email,
                  helperText: 'Email address for this location'
                });
                return automationIdProps;
              })()}>
                <Label htmlFor="email-input">Email</Label>
                <Input
                  id="email-input"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>
            </div>
            
            <div {...(() => {
              const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                id: 'tax-region-field',
                type: 'formField',
                fieldType: 'select',
                label: 'Tax Region',
                value: formData.region_code || 'none',
                helperText: 'Select the applicable tax region'
              });
              return automationIdProps;
            })()}>
              <Label htmlFor="tax-region-select">Tax Region</Label>
              <CustomSelect
                id="tax-region-select"
                value={formData.region_code || 'none'}
                onValueChange={(value) => setFormData(prev => ({ ...prev, region_code: value === 'none' ? null : value }))}
                options={[
                  { value: 'none', label: 'Select a tax region...' },
                  ...taxRegions.map(region => ({
                    value: region.region_code,
                    label: region.region_name
                  }))
                ]}
                placeholder="Select a tax region..."
              />
            </div>
            
            <div {...(() => {
              const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                id: 'notes-field',
                type: 'formField',
                fieldType: 'textField',
                label: 'Notes',
                value: formData.notes,
                helperText: 'Additional notes about this location'
              });
              return automationIdProps;
            })()}>
              <Label htmlFor="notes-input">Notes</Label>
              <TextArea
                id="notes-input"
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                rows={3}
              />
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center space-x-2" {...(() => {
                const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                  id: 'is-default-field',
                  type: 'formField',
                  fieldType: 'checkbox',
                  label: 'Default Location',
                  value: formData.is_default ? 'Yes' : 'No',
                  helperText: 'Mark this as the default location for the company'
                });
                return automationIdProps;
              })()}>
                <Switch
                  id="is-default-switch"
                  checked={formData.is_default}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_default: checked }))}
                />
                <Label htmlFor="is-default-switch">Default Location</Label>
              </div>
              
              <div className="flex items-center space-x-2" {...(() => {
                const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                  id: 'is-billing-address-field',
                  type: 'formField',
                  fieldType: 'checkbox',
                  label: 'Billing Address',
                  value: formData.is_billing_address ? 'Yes' : 'No',
                  helperText: 'Use this location as the billing address'
                });
                return automationIdProps;
              })()}>
                <Switch
                  id="is-billing-address-switch"
                  checked={formData.is_billing_address}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_billing_address: checked }))}
                />
                <Label htmlFor="is-billing-address-switch">Billing Address</Label>
              </div>
              
              <div className="flex items-center space-x-2" {...(() => {
                const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
                  id: 'is-shipping-address-field',
                  type: 'formField',
                  fieldType: 'checkbox',
                  label: 'Shipping Address',
                  value: formData.is_shipping_address ? 'Yes' : 'No',
                  helperText: 'Use this location as the shipping address'
                });
                return automationIdProps;
              })()}>
                <Switch
                  id="is-shipping-address-switch"
                  checked={formData.is_shipping_address}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_shipping_address: checked }))}
                />
                <Label htmlFor="is-shipping-address-switch">Shipping Address</Label>
              </div>
            </div>
            
            <DialogFooter>
              <Button 
                id="cancel-location-button"
                data-automation-id="cancel-location-button"
                variant="outline" 
                onClick={() => {
                  setIsDialogOpen(false);
                  setHasAttemptedSubmit(false);
                  setValidationErrors([]);
                }}
                disabled={isLoading}
                type="button"
              >
                Cancel
              </Button>
              <Button 
                id="save-location-button"
                data-automation-id="save-location-button"
                type="submit"
                disabled={isLoading}
                className={!formData.address_line1 || !formData.city || !formData.country_name ? 'opacity-50' : ''}
              >
                {isLoading ? 'Saving...' : 'Save Location'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        id="delete-location-confirmation-dialog"
        isOpen={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setLocationToDelete(null);
        }}
        onConfirm={confirmDeleteLocation}
        title="Delete Location"
        message={locationToDelete ? `Are you sure you want to delete the location "${locationToDelete.location_name || 'Unnamed Location'}"? This action cannot be undone.` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
      
      {/* Locations List */}
      <div className="space-y-3">
        {locations.map((location) => (
          <LocationCard
            key={location.location_id}
            location={location}
            onEdit={handleEditLocation}
            onDelete={handleDeleteLocation}
            onSetDefault={handleSetDefault}
            formatAddress={formatAddress}
          />
        ))}
        
        {locations.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <MapPin className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No locations added yet</p>
            <p className="text-sm">Click "Add Location" to get started</p>
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
}