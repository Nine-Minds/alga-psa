'use client';

import { useEffect, useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Card } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { getCurrentUser, getUserRolesWithPermissions, getUserCompanyId } from 'server/src/lib/actions/user-actions/userActions';
import { getCompanyById, updateCompany, uploadCompanyLogo, deleteCompanyLogo } from 'server/src/lib/actions/company-actions/companyActions';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IPermission } from 'server/src/interfaces/auth.interfaces';
import EntityImageUpload from 'server/src/components/ui/EntityImageUpload';
import CompanyLocations from 'server/src/components/companies/CompanyLocations';
import { Text, Flex } from '@radix-ui/themes';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { FormFieldComponent } from 'server/src/types/ui-reflection/types';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';

const TextDetailItem: React.FC<{
  label: string;
  value: string;
  onEdit: (value: string) => void;
  automationId?: string;
}> = ({ label, value, onEdit, automationId }) => {
  const [localValue, setLocalValue] = useState(value);

  const { automationIdProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: automationId,
    type: 'formField',
    fieldType: 'textField',
    label: label,
    value: localValue,
    helperText: `Input field for ${label}`
  });

  const handleBlur = () => {
    if (localValue !== value) {
      onEdit(localValue);
    }
  };
  
  return (
    <div className="space-y-2" {...automationIdProps}>
      <Text as="label" size="2" className="text-gray-700 font-medium">{label}</Text>
      <Input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      />
    </div>
  );
};

export function CompanyDetailsSettings() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyDetails, setCompanyDetails] = useState<ICompany | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isLocationsDialogOpen, setIsLocationsDialogOpen] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/auth/signin');
          return;
        }

        const rolesWithPermissions = await getUserRolesWithPermissions(user.user_id);
        
        const hasRequiredPermissions = rolesWithPermissions.some(role => 
          role.permissions.some((permission: IPermission) => 
            `${permission.resource}.${permission.action}` === 'company_setting.read' || 
            `${permission.resource}.${permission.action}` === 'company_setting.update' ||
            `${permission.resource}.${permission.action}` === 'company_setting.delete'
          )
        );

        if (!hasRequiredPermissions) {
          setError('You do not have permission to access company settings');
          return;
        }

        const userCompanyId = await getUserCompanyId(user.user_id);
        if (!userCompanyId) {
          setError('Company not found');
          return;
        }

        const company = await getCompanyById(userCompanyId);
        if (!company) {
          setError('Failed to load company details');
          return;
        }

        setCompanyDetails(company);
      } catch (error) {
        console.error('Error loading company details:', error);
        setError('Failed to load company details');
      }
    }

    loadData();
  }, [router]);

  const handleFieldChange = (field: string, value: string) => {
    setCompanyDetails(prevCompany => {
      if (!prevCompany) return prevCompany;
      
      const updatedCompany = JSON.parse(JSON.stringify(prevCompany)) as ICompany;
      
      if (field.startsWith('properties.')) {
        const propertyField = field.split('.')[1];
        
        if (!updatedCompany.properties) {
          updatedCompany.properties = {};
        }
        
        (updatedCompany.properties as any)[propertyField] = value;
        
        if (propertyField === 'website') {
          updatedCompany.url = value;
        }
      } else if (field === 'url') {
        updatedCompany.url = value;
        
        if (!updatedCompany.properties) {
          updatedCompany.properties = {};
        }
        
        (updatedCompany.properties as any).website = value;
      } else {
        (updatedCompany as any)[field] = value;
      }
      
      return updatedCompany;
    });
    
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    if (!companyDetails?.company_id || isLoading) return;
    
    setIsLoading(true);
    try {
      const updatedCompany = await updateCompany(companyDetails.company_id, {
        company_name: companyDetails.company_name,
        phone: companyDetails.phone,
        email: companyDetails.email,
        url: companyDetails.url,
        address: companyDetails.address,
        properties: {
          ...companyDetails.properties,
          industry: companyDetails.properties?.industry,
          company_size: companyDetails.properties?.company_size,
          annual_revenue: companyDetails.properties?.annual_revenue
        }
      });
      setCompanyDetails(updatedCompany);
      setHasUnsavedChanges(false);
      toast.success('Company details updated successfully');
    } catch (error) {
      console.error('Failed to update company details:', error);
      toast.error('Failed to update company details');
    } finally {
      setIsLoading(false);
    }
  };

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  if (!companyDetails) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
      {/* Logo Upload Section */}
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-4">Company Logo</h3>
        <div className="flex items-center space-x-4">
          <EntityImageUpload
            entityType="company"
            entityId={companyDetails.company_id}
            entityName={companyDetails.company_name}
            imageUrl={companyDetails.logoUrl ?? null}
            uploadAction={uploadCompanyLogo}
            deleteAction={deleteCompanyLogo}
            onImageChange={async (newLogoUrl) => {
              setCompanyDetails(prev => prev ? { ...prev, logoUrl: newLogoUrl } : null);
              
              // If logo was deleted (newLogoUrl is null), refresh company data to ensure consistency
              if (newLogoUrl === null && companyDetails?.company_id) {
                console.log("Logo deleted, refreshing company data...");
                try {
                  const refreshedCompany = await getCompanyById(companyDetails.company_id);
                  if (refreshedCompany) {
                    setCompanyDetails(refreshedCompany);
                  }
                } catch (error) {
                  console.error('Error refreshing company data after logo deletion:', error);
                }
              }
            }}
            size="xl"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column - All Form Fields */}
        <div className="space-y-6">
          <TextDetailItem
            label="Company Name"
            value={companyDetails.company_name}
            onEdit={(value) => handleFieldChange('company_name', value)}
            automationId="company-name-field"
          />

          <TextDetailItem
            label="Website"
            value={companyDetails.properties?.website || companyDetails.url || ''}
            onEdit={(value) => handleFieldChange('properties.website', value)}
            automationId="website-field"
          />

          <TextDetailItem
            label="Industry"
            value={companyDetails.properties?.industry || ''}
            onEdit={(value) => handleFieldChange('properties.industry', value)}
            automationId="industry-field"
          />

          <TextDetailItem
            label="Company Size"
            value={companyDetails.properties?.company_size || ''}
            onEdit={(value) => handleFieldChange('properties.company_size', value)}
            automationId="company-size-field"
          />
          
          <TextDetailItem
            label="Annual Revenue"
            value={companyDetails.properties?.annual_revenue || ''}
            onEdit={(value) => handleFieldChange('properties.annual_revenue', value)}
            automationId="annual-revenue-field"
          />
        </div>
        
        {/* Right Column - Company Locations */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Text as="label" size="2" className="text-gray-700 font-medium">Company Locations</Text>
            <Button
              id="locations-button"
              size="sm"
              variant="outline"
              onClick={() => setIsLocationsDialogOpen(true)}
              className="text-sm"
            >
              Manage Locations
            </Button>
          </div>
          <div>
            <CompanyLocations 
              companyId={companyDetails.company_id} 
              isEditing={false}
            />
          </div>
        </div>
      </div>
      
      <Flex gap="4" justify="end" align="center" className="pt-6">
        <Button
          id="save-company-changes-btn"
          onClick={handleSave}
          disabled={isLoading || !hasUnsavedChanges}
          className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Saving...' : 'Save Changes'}
        </Button>
      </Flex>

      <Dialog 
        isOpen={isLocationsDialogOpen} 
        onClose={() => setIsLocationsDialogOpen(false)}
        title={`Manage Locations - ${companyDetails.company_name}`}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <CompanyLocations 
            companyId={companyDetails.company_id} 
            isEditing={true}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
