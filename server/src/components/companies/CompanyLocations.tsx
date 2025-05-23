'use client';

import React, { useState, useEffect } from 'react';
import { ICompanyLocation } from '../../interfaces/company.interfaces';
import { 
  getCompanyLocations, 
  createCompanyLocation, 
  updateCompanyLocation, 
  deleteCompanyLocation,
  setDefaultCompanyLocation 
} from '../../lib/actions/companyLocationActions';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { TextArea } from '../ui/TextArea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/Dialog';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { Plus, Edit2, Trash2, MapPin, Star } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';

interface CompanyLocationsProps {
  companyId: string;
  isEditing: boolean;
}

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
  region_code: string;
  phone: string;
  fax: string;
  email: string;
  notes: string;
  is_billing_address: boolean;
  is_shipping_address: boolean;
  is_default: boolean;
}

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
  region_code: '',
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
  const { toast } = useToast();

  useEffect(() => {
    loadLocations();
  }, [companyId]);

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
      region_code: location.region_code || '',
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

  const handleSaveLocation = async () => {
    setIsLoading(true);
    try {
      if (editingLocation) {
        await updateCompanyLocation(editingLocation.location_id, formData);
        toast({
          title: 'Success',
          description: 'Location updated successfully',
        });
      } else {
        await createCompanyLocation(companyId, { ...formData, company_id: companyId });
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
    if (!confirm('Are you sure you want to delete this location?')) {
      return;
    }

    try {
      await deleteCompanyLocation(locationId);
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

  const formatAddress = (location: ICompanyLocation) => {
    const parts = [
      location.address_line1,
      location.address_line2,
      location.address_line3,
      location.city,
      location.state_province,
      location.postal_code,
      location.country_name
    ].filter(Boolean);
    
    return parts.join(', ');
  };

  if (!isEditing) {
    const defaultLocation = locations.find(loc => loc.is_default);
    if (defaultLocation) {
      return (
        <div className="text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span>{formatAddress(defaultLocation)}</span>
          </div>
        </div>
      );
    }
    return <span className="text-gray-400 text-sm">No locations</span>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Locations</h3>
        <Dialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)}>
          <DialogTrigger asChild>
            <Button 
              id="add-company-location-button"
              onClick={handleAddLocation} 
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Location
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingLocation ? 'Edit Location' : 'Add New Location'}
              </DialogTitle>
            </DialogHeader>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="location-name-input">Location Name</Label>
                <Input
                  id="location-name-input"
                  value={formData.location_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, location_name: e.target.value }))}
                  placeholder="e.g., Main Office, Warehouse"
                />
              </div>
              
              <div className="col-span-2">
                <Label htmlFor="address-line1-input">Address Line 1 *</Label>
                <Input
                  id="address-line1-input"
                  value={formData.address_line1}
                  onChange={(e) => setFormData(prev => ({ ...prev, address_line1: e.target.value }))}
                  required
                />
              </div>
              
              <div>
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
              
              <div>
                <Label htmlFor="city-input">City *</Label>
                <Input
                  id="city-input"
                  value={formData.city}
                  onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                  required
                />
              </div>
              
              <div>
                <Label htmlFor="state-province-input">State/Province</Label>
                <Input
                  id="state-province-input"
                  value={formData.state_province}
                  onChange={(e) => setFormData(prev => ({ ...prev, state_province: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="postal-code-input">Postal Code</Label>
                <Input
                  id="postal-code-input"
                  value={formData.postal_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, postal_code: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="country-code-input">Country Code *</Label>
                <Input
                  id="country-code-input"
                  value={formData.country_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, country_code: e.target.value }))}
                  placeholder="US"
                  maxLength={2}
                  required
                />
              </div>
              
              <div className="col-span-2">
                <Label htmlFor="country-name-input">Country Name *</Label>
                <Input
                  id="country-name-input"
                  value={formData.country_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, country_name: e.target.value }))}
                  required
                />
              </div>
              
              <div>
                <Label htmlFor="phone-input">Phone</Label>
                <Input
                  id="phone-input"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="email-input">Email</Label>
                <Input
                  id="email-input"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>
              
              <div className="col-span-2">
                <Label htmlFor="notes-input">Notes</Label>
                <TextArea
                  id="notes-input"
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                />
              </div>
              
              <div className="col-span-2 space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="is-default-switch"
                    checked={formData.is_default}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_default: checked }))}
                  />
                  <Label htmlFor="is-default-switch">Default Location</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="is-billing-address-switch"
                    checked={formData.is_billing_address}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_billing_address: checked }))}
                  />
                  <Label htmlFor="is-billing-address-switch">Billing Address</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="is-shipping-address-switch"
                    checked={formData.is_shipping_address}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_shipping_address: checked }))}
                  />
                  <Label htmlFor="is-shipping-address-switch">Shipping Address</Label>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2 mt-6">
              <Button 
                id="cancel-location-button"
                variant="outline" 
                onClick={() => setIsDialogOpen(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button 
                id="save-location-button"
                onClick={handleSaveLocation}
                disabled={isLoading || !formData.address_line1 || !formData.city || !formData.country_name}
              >
                {isLoading ? 'Saving...' : 'Save Location'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      
      <div className="space-y-3">
        {locations.map((location) => (
          <Card key={location.location_id} className="relative">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {location.location_name || 'Unnamed Location'}
                  {location.is_default && (
                    <Star className="h-4 w-4 text-yellow-500 fill-current" />
                  )}
                </CardTitle>
                
                <div className="flex gap-2">
                  {!location.is_default && (
                    <Button
                      id={`set-default-location-${location.location_id}-button`}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetDefault(location.location_id)}
                      title="Set as default"
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  
                  <Button
                    id={`edit-location-${location.location_id}-button`}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditLocation(location)}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  
                  <Button
                    id={`delete-location-${location.location_id}-button`}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteLocation(location.location_id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="pt-0">
              <div className="text-sm text-gray-600">
                <div>{formatAddress(location)}</div>
                {location.phone && (
                  <div className="mt-1">Phone: {location.phone}</div>
                )}
                {location.email && (
                  <div>Email: {location.email}</div>
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
                  <div className="mt-2 text-xs text-gray-500">
                    {location.notes}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        
        {locations.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <MapPin className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No locations added yet</p>
            <p className="text-sm">Click "Add Location" to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}