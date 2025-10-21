'use client';

import { useState, useEffect } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { Asset, CreateAssetRequest, WorkstationAsset, NetworkDeviceAsset } from 'server/src/interfaces/asset.interfaces';
import { IClient } from 'server/src/interfaces';
import { createAsset } from 'server/src/lib/actions/asset-actions/assetActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
// ClientPicker replaced with CustomSelect
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

interface CreateAssetDialogProps {
  onClose: () => void;
  onAssetCreated: (asset: Asset) => void;
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'retired', label: 'Retired' },
];

const ASSET_TYPE_OPTIONS: SelectOption[] = [
  { value: 'workstation', label: 'Workstation' },
  { value: 'network_device', label: 'Network Device' },
  { value: 'server', label: 'Server' },
  { value: 'mobile_device', label: 'Mobile Device' },
  { value: 'printer', label: 'Printer' }
];

type WorkstationFields = Required<Omit<WorkstationAsset, 'tenant' | 'asset_id'>>;
type NetworkDeviceFields = Required<Omit<NetworkDeviceAsset, 'tenant' | 'asset_id'>>;

const INITIAL_WORKSTATION: WorkstationFields = {
  os_type: '',
  os_version: '',
  cpu_model: '',
  cpu_cores: 0,
  ram_gb: 0,
  storage_type: '',
  storage_capacity_gb: 0,
  gpu_model: '',
  installed_software: [],
  last_login: new Date().toISOString()
};

const INITIAL_NETWORK_DEVICE: NetworkDeviceFields = {
  device_type: 'switch',
  management_ip: '',
  port_count: 0,
  firmware_version: '',
  supports_poe: false,
  power_draw_watts: 0,
  vlan_config: {},
  port_config: {}
};

const INITIAL_FORM_DATA: Omit<CreateAssetRequest, 'asset_type'> & { asset_type: string } = {
  asset_type: '',
  client_id: '',
  asset_tag: '',
  name: '',
  status: 'active',
  workstation: INITIAL_WORKSTATION,
  network_device: INITIAL_NETWORK_DEVICE
};

export default function CreateAssetDialog({ onClose, onAssetCreated }: CreateAssetDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchClients = async () => {
      try {
        const clientsList = await getAllClients(false);
        setClients(clientsList);
      } catch (error) {
        console.error('Error fetching clients:', error);
      } finally {
        setIsLoadingClients(false);
      }
    };

    fetchClients();
  }, []);

  const validateForm = () => {
    const validationErrors: string[] = [];
    if (!formData.name.trim()) validationErrors.push('Name');
    if (!formData.asset_tag.trim()) validationErrors.push('Asset Tag');
    if (!formData.asset_type) validationErrors.push('Asset Type');
    return validationErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(validationErrors.join('\n'));
      return;
    }
    
    setIsSubmitting(true);
    setError(null);

    try {
      const assetData: CreateAssetRequest = {
        ...formData,
        asset_type: formData.asset_type as CreateAssetRequest['asset_type']
      };
      const newAsset = await createAsset(assetData);
      onAssetCreated(newAsset);
      onClose();
    } catch (error) {
      console.error('Error creating asset:', error);
      setError('Failed to create asset. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setError(null);
    }
  };

  const handleChange = (field: keyof typeof INITIAL_FORM_DATA, value: string): void => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    clearErrorIfSubmitted();
  };

  const updateWorkstationField = <K extends keyof WorkstationFields>(
    field: K,
    value: WorkstationFields[K]
  ): void => {
    setFormData(prev => ({
      ...prev,
      workstation: {
        ...INITIAL_WORKSTATION,
        ...prev.workstation,
        [field]: value
      }
    }));
  };

  const updateNetworkDeviceField = <K extends keyof NetworkDeviceFields>(
    field: K,
    value: NetworkDeviceFields[K]
  ): void => {
    setFormData(prev => ({
      ...prev,
      network_device: {
        ...INITIAL_NETWORK_DEVICE,
        ...prev.network_device,
        [field]: value
      }
    }));
  };

  // Render type-specific fields based on the selected asset type
  const renderTypeSpecificFields = () => {
    if (!formData.asset_type) return null;

    switch (formData.asset_type) {
      case 'workstation':
        return (
          <>
            <div>
              <Label>OS Type</Label>
              <Input
                id="workstation-os-type"
                value={formData.workstation?.os_type || ''}
                onChange={(e) => updateWorkstationField('os_type', e.target.value)}
                placeholder="e.g., Windows 11"
              />
            </div>
            <div>
              <Label>CPU Model</Label>
              <Input
                id="workstation-cpu-model"
                value={formData.workstation?.cpu_model || ''}
                onChange={(e) => updateWorkstationField('cpu_model', e.target.value)}
                placeholder="e.g., Intel Core i7-12700"
              />
            </div>
            <div>
              <Label>RAM (GB)</Label>
              <Input
                id="workstation-ram-gb"
                type="number"
                value={formData.workstation?.ram_gb || ''}
                onChange={(e) => updateWorkstationField('ram_gb', parseInt(e.target.value) || 0)}
              />
            </div>
          </>
        );
      case 'network_device':
        return (
          <>
            <div>
              <Label>Device Type</Label>
              <CustomSelect
                id="network-device-type"
                options={[
                  { value: 'switch', label: 'Switch' },
                  { value: 'router', label: 'Router' },
                  { value: 'firewall', label: 'Firewall' },
                  { value: 'access_point', label: 'Access Point' },
                  { value: 'load_balancer', label: 'Load Balancer' }
                ]}
                value={formData.network_device?.device_type || 'switch'}
                onValueChange={(value) => updateNetworkDeviceField('device_type', value as NetworkDeviceFields['device_type'])}
              />
            </div>
            <div>
              <Label>Management IP</Label>
              <Input
                id="network-management-ip"
                value={formData.network_device?.management_ip || ''}
                onChange={(e) => updateNetworkDeviceField('management_ip', e.target.value)}
                placeholder="e.g., 192.168.1.100"
              />
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title="Create New Asset"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Error Display */}
        {hasAttemptedSubmit && error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p className="font-medium mb-2">Please fill in the required fields:</p>
              <ul className="list-disc list-inside space-y-1">
                {error.split('\n').map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Base fields */}
        <div>
          <Label htmlFor="name">Name *</Label>
          <div className="mt-1">
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Enter asset name"
              className={hasAttemptedSubmit && !formData.name.trim() ? 'border-red-500' : ''}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="asset_tag">Asset Tag *</Label>
          <div className="mt-1">
            <Input
              id="asset_tag"
              value={formData.asset_tag}
              onChange={(e) => handleChange('asset_tag', e.target.value)}
              placeholder="Enter asset tag"
              className={hasAttemptedSubmit && !formData.asset_tag.trim() ? 'border-red-500' : ''}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="asset_type">Asset Type *</Label>
          <div className="mt-1">
            <CustomSelect
              id="asset-type-select"
              options={ASSET_TYPE_OPTIONS}
              value={formData.asset_type}
              onValueChange={(value) => handleChange('asset_type', value)}
              placeholder="Select Asset Type"
              className={hasAttemptedSubmit && !formData.asset_type ? 'border-red-500' : ''}
            />
          </div>
        </div>

        {/* Type-specific fields */}
        {renderTypeSpecificFields()}

        {/* Common fields */}
        <div>
          <Label htmlFor="client_id">Client</Label>
          <div className="mt-1">
            <CustomSelect
              id="client-select"
              options={clients.map(client => ({ value: client.client_id, label: client.client_name }))}
              value={formData.client_id}
              onValueChange={(value) => handleChange('client_id', value)}
              placeholder="Select Client"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="status">Status</Label>
          <div className="mt-1">
            <CustomSelect
              id="status-select"
              options={STATUS_OPTIONS}
              value={formData.status}
              onValueChange={(value) => handleChange('status', value)}
              placeholder="Select Status"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="location">Location</Label>
          <div className="mt-1">
            <Input
              id="location"
              value={formData.location || ''}
              onChange={(e) => handleChange('location', e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="serial_number">Serial Number</Label>
          <div className="mt-1">
            <Input
              id="serial_number"
              value={formData.serial_number || ''}
              onChange={(e) => handleChange('serial_number', e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button
            id='cancel-button'
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            id='create-button'
            type="submit"
            disabled={isSubmitting || isLoadingClients}
            className={!formData.asset_type || !formData.name.trim() || !formData.asset_tag.trim() ? 'opacity-50' : ''}
          >
            {isSubmitting ? 'Creating...' : 'Create Asset'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
