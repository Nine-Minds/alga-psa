'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { getCurrentUser, getUserRolesWithPermissions, getUserClientId } from '@alga-psa/users/actions';
import { getClientById, updateClient, uploadClientLogo, deleteClientLogo } from '@alga-psa/clients/actions';
import { IClient } from '@alga-psa/types';
import { IPermission } from '@alga-psa/types';
import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import ClientLocations from '@alga-psa/clients/components/clients/ClientLocations';
import { Text, Flex } from '@radix-ui/themes';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { FormFieldComponent } from '@alga-psa/ui/ui-reflection/types';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';

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

export function ClientDetailsSettings() {
  const { t } = useTranslation('clientPortal');
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientDetails, setClientDetails] = useState<IClient | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isLocationsDialogOpen, setIsLocationsDialogOpen] = useState(false);
  const [locationsRefreshKey, setLocationsRefreshKey] = useState(0);

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
            `${permission.resource}.${permission.action}` === 'client.read' || 
            `${permission.resource}.${permission.action}` === 'client.update'
          )
        );

        if (!hasRequiredPermissions) {
          setError(t('clientSettings.messages.noPermission', 'You do not have permission to access client settings'));
          return;
        }

        const userClientId = await getUserClientId(user.user_id);
        if (!userClientId) {
          setError(t('clientSettings.messages.clientNotFound', 'Client not found'));
          return;
        }

        const client = await getClientById(userClientId);
        if (!client) {
          setError(t('clientSettings.messages.failedToLoad'));
          return;
        }

        setClientDetails(client);

      } catch (error) {
        console.error('Error loading client details:', error);
        setError(t('clientSettings.messages.detailsLoadError', 'Failed to load client details'));
      }
    }

    loadData();
  }, [router]);

  const handleFieldChange = (field: string, value: string) => {
    setClientDetails((prevClient) => {
      if (!prevClient) return prevClient;
      
      const updatedClient = JSON.parse(JSON.stringify(prevClient)) as IClient;
      
      if (field.startsWith('properties.')) {
        const propertyField = field.split('.')[1];
        
        if (!updatedClient.properties) {
          updatedClient.properties = {};
        }
        
        (updatedClient.properties as any)[propertyField] = value;
        
        if (propertyField === 'website') {
          updatedClient.url = value;
        }
      } else if (field === 'url') {
        updatedClient.url = value;
        
        if (!updatedClient.properties) {
          updatedClient.properties = {};
        }
        
        (updatedClient.properties as any).website = value;
      } else {
        (updatedClient as any)[field] = value;
      }
      
      return updatedClient;
    });
    
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    if (!clientDetails?.client_id || isLoading) return;
    
    setIsLoading(true);
    try {
      const updatedClient = await updateClient(clientDetails.client_id, {
        client_name: clientDetails.client_name,
        url: clientDetails.url,
        properties: {
          ...clientDetails.properties,
          industry: clientDetails.properties?.industry,
          company_size: clientDetails.properties?.company_size,
          annual_revenue: clientDetails.properties?.annual_revenue
        }
      });
      setClientDetails(updatedClient);
      setHasUnsavedChanges(false);
      toast.success(t('clientSettings.messages.updateSuccess'));
    } catch (error) {
      console.error('Failed to update client details:', error);
      toast.error(t('clientSettings.messages.updateError', 'Failed to update client details'));
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

  if (!clientDetails) {
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
        <h3 className="text-lg font-medium mb-4">{t('clientSettings.fields.clientLogo')}</h3>
        <div className="flex items-center space-x-4">
          <EntityImageUpload
            entityType="client"
            entityId={clientDetails.client_id}
            entityName={clientDetails.client_name}
            imageUrl={clientDetails.logoUrl ?? null}
            uploadAction={uploadClientLogo}
            deleteAction={deleteClientLogo}
            onImageChange={async (newLogoUrl) => {
              
              // If logo was deleted (newLogoUrl is null), refresh client data to ensure consistency
              if (newLogoUrl === null && clientDetails?.client_id) {
                console.log("Logo deleted, refreshing client data...");
                try {
                  const refreshedClient = await getClientById(clientDetails.client_id);
                  if (refreshedClient) {
                  }
                } catch (error) {
                  console.error('Error refreshing client data after logo deletion:', error);
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
            label={t('clientSettings.fields.clientName')}
            value={clientDetails.client_name}
            onEdit={(value) => handleFieldChange('client_name', value)}
            automationId="client-name-field"
          />

          <TextDetailItem
            label={t('clientSettings.fields.website')}
            value={clientDetails.properties?.website || clientDetails.url || ''}
            onEdit={(value) => handleFieldChange('properties.website', value)}
            automationId="website-field"
          />

          <TextDetailItem
            label={t('clientSettings.fields.industry')}
            value={clientDetails.properties?.industry || ''}
            onEdit={(value) => handleFieldChange('properties.industry', value)}
            automationId="industry-field"
          />

          <TextDetailItem
            label={t('clientSettings.fields.company_size')}
            value={clientDetails.properties?.company_size || ''}
            onEdit={(value) => handleFieldChange('properties.company_size', value)}
            automationId="company-size-field"
          />
          
          <TextDetailItem
            label={t('clientSettings.fields.annualRevenue')}
            value={clientDetails.properties?.annual_revenue || ''}
            onEdit={(value) => handleFieldChange('properties.annual_revenue', value)}
            automationId="annual-revenue-field"
          />
        </div>
        
        {/* Right Column - Client Locations */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Text as="label" size="2" className="text-gray-700 font-medium">{t('clientSettings.fields.clientLocations')}</Text>
            <Button
              id="locations-button"
              size="sm"
              variant="outline"
              onClick={() => setIsLocationsDialogOpen(true)}
              className="text-sm"
            >
              {t('clientSettings.fields.manageLocations')}
            </Button>
          </div>
          <div>
            <ClientLocations
              key={locationsRefreshKey}
              clientId={clientDetails.client_id}
              isEditing={false}
            />
          </div>
        </div>
      </div>
      
      <Flex gap="4" justify="end" align="center" className="pt-6">
        <Button
          id="save-client-changes-btn"
          onClick={handleSave}
          disabled={isLoading || !hasUnsavedChanges}
          className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? t('common.loading') : t('clientSettings.messages.saveChanges')}
        </Button>
      </Flex>

      <Dialog
        isOpen={isLocationsDialogOpen}
        onClose={() => {
          setIsLocationsDialogOpen(false);
          setLocationsRefreshKey(prev => prev + 1);
        }}
        title={`${t('clientSettings.fields.manageLocations')} - ${clientDetails.client_name}`}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <ClientLocations
            clientId={clientDetails.client_id}
            isEditing={true}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
