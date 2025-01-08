'use client';

import React, { useState, useEffect } from 'react';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect';
import { createAsset } from '@/lib/actions/asset-actions/assetActions';
import { CreateAssetRequest } from '@/interfaces/asset.interfaces';
import { CompanyPicker } from '@/components/companies/CompanyPicker';
import { ICompany } from '@/interfaces';
import { getAllCompanies } from '@/lib/actions/companyActions';

interface QuickAddAssetProps {
  companyId?: string;
  onAssetAdded: () => void;
}

type NetworkDeviceType = 'switch' | 'router' | 'firewall' | 'access_point' | 'load_balancer';
type AssetStatus = 'active' | 'inactive' | 'maintenance';
type AssetType = 'workstation' | 'network_device' | 'server' | 'mobile_device' | 'printer';

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'maintenance', label: 'Maintenance' }
];

const ASSET_TYPE_OPTIONS: SelectOption[] = [
  { value: 'workstation', label: 'Workstation' },
  { value: 'network_device', label: 'Network Device' },
  { value: 'server', label: 'Server' },
  { value: 'mobile_device', label: 'Mobile Device' },
  { value: 'printer', label: 'Printer' }
];

interface FormData {
  name: string;
  asset_tag: string;
  asset_type: AssetType | '';
  status: AssetStatus;
  serial_number: string;
  workstation: {
    os_type: string;
    os_version: string;
  };
  network_device: {
    device_type: NetworkDeviceType;
    management_ip: string;
  };
  server: {
    os_type: string;
    os_version: string;
  };
  mobile_device: {
    os_type: string;
    model: string;
    is_supervised: boolean;
  };
  printer: {
    model: string;
  };
}

export function QuickAddAsset({ companyId, onAssetAdded }: QuickAddAssetProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(companyId || null);

  const updateDialog = useRegisterUIComponent({
    id: 'quick-add-asset-dialog',
    type: 'dialog',
    label: 'Quick Add Asset',
    open,
    title: 'Add New Asset'
  });

  useEffect(() => {
    updateDialog({ open });
  }, [open, updateDialog]);

  // Initialize with minimum required fields
  const [formData, setFormData] = useState<FormData>({
    name: '',
    asset_tag: '',
    asset_type: '',
    status: 'active',
    serial_number: '',
    // Type-specific fields will be added conditionally
    workstation: {
      os_type: '',
      os_version: ''
    },
    network_device: {
      device_type: 'switch',
      management_ip: ''
    },
    server: {
      os_type: '',
      os_version: ''
    },
    mobile_device: {
      os_type: '',
      model: '',
      is_supervised: false
    },
    printer: {
      model: ''
    }
  });

  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        if (!companyId) {
          const companiesData = await getAllCompanies(false);
          setCompanies(companiesData);
        }
      } catch (error) {
        console.error('Error fetching companies:', error);
        setError('Failed to fetch companies');
      }
    };
    if (open) {
      fetchCompanies();
    }
  }, [open, companyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const effectiveCompanyId = companyId || selectedCompanyId;
      if (!effectiveCompanyId) {
        throw new Error('Please select a company');
      }

      if (!formData.asset_type) {
        throw new Error('Please select an asset type');
      }

      const assetData: CreateAssetRequest = {
        asset_type: formData.asset_type,
        company_id: effectiveCompanyId,
        asset_tag: formData.asset_tag,
        name: formData.name,
        status: formData.status,
        serial_number: formData.serial_number || undefined
      };

      // Add type-specific data based on the selected type
      switch (formData.asset_type) {
        case 'workstation':
          assetData.workstation = {
            os_type: formData.workstation.os_type,
            os_version: formData.workstation.os_version,
            cpu_model: '',
            cpu_cores: 0,
            ram_gb: 0,
            storage_type: '',
            storage_capacity_gb: 0,
            installed_software: []
          };
          break;
        case 'network_device':
          assetData.network_device = {
            device_type: formData.network_device.device_type,
            management_ip: formData.network_device.management_ip,
            port_count: 0,
            firmware_version: '',
            supports_poe: false,
            power_draw_watts: 0,
            vlan_config: {},
            port_config: {}
          };
          break;
        case 'server':
          assetData.server = {
            os_type: formData.server.os_type,
            os_version: formData.server.os_version,
            cpu_model: '',
            cpu_cores: 0,
            ram_gb: 0,
            storage_config: [],
            is_virtual: false,
            network_interfaces: [],
            installed_services: []
          };
          break;
        case 'mobile_device':
          assetData.mobile_device = {
            os_type: formData.mobile_device.os_type,
            os_version: '',
            model: formData.mobile_device.model,
            is_supervised: formData.mobile_device.is_supervised,
            installed_apps: []
          };
          break;
        case 'printer':
          assetData.printer = {
            model: formData.printer.model,
            is_network_printer: false,
            supports_color: false,
            supports_duplex: false,
            supported_paper_types: [],
            supply_levels: {}
          };
          break;
      }

      await createAsset(assetData);
      onAssetAdded();
      setOpen(false);
      // Reset form
      setFormData({
        name: '',
        asset_tag: '',
        asset_type: '',
        status: 'active',
        serial_number: '',
        workstation: { os_type: '', os_version: '' },
        network_device: { device_type: 'switch', management_ip: '' },
        server: { os_type: '', os_version: '' },
        mobile_device: { os_type: '', model: '', is_supervised: false },
        printer: { model: '' }
      });
      if (!companyId) {
        setSelectedCompanyId(null);
      }
    } catch (error) {
      console.error('Error creating asset:', error);
      setError(error instanceof Error ? error.message : 'Failed to create asset');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderTypeSpecificFields = () => {
    if (!formData.asset_type) return null;

    switch (formData.asset_type) {
      case 'workstation':
        return (
          <>
            <div {...withDataAutomationId({ id: 'workstation-os-type-container' })}>
              <label className="block text-sm font-medium text-gray-700">OS Type</label>
              <Input
                {...withDataAutomationId({ id: 'workstation-os-type-input' })}
                value={formData.workstation.os_type}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  workstation: { ...prev.workstation, os_type: e.target.value }
                }))}
                placeholder="e.g., Windows, macOS, Linux"
                required
              />
            </div>
            <div {...withDataAutomationId({ id: 'workstation-os-version-container' })}>
              <label className="block text-sm font-medium text-gray-700">OS Version</label>
              <Input
                {...withDataAutomationId({ id: 'workstation-os-version-input' })}
                value={formData.workstation.os_version}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  workstation: { ...prev.workstation, os_version: e.target.value }
                }))}
                placeholder="e.g., 11, Monterey, Ubuntu 22.04"
                required
              />
            </div>
          </>
        );

      case 'network_device':
        return (
          <>
            <div {...withDataAutomationId({ id: 'network-device-type-container' })}>
              <label className="block text-sm font-medium text-gray-700">Device Type</label>
              <CustomSelect
                {...withDataAutomationId({ id: 'network-device-type-select' })}
                options={[
                  { value: 'switch', label: 'Switch' },
                  { value: 'router', label: 'Router' },
                  { value: 'firewall', label: 'Firewall' },
                  { value: 'access_point', label: 'Access Point' },
                  { value: 'load_balancer', label: 'Load Balancer' }
                ]}
                value={formData.network_device.device_type}
                onValueChange={(value) => setFormData(prev => ({
                  ...prev,
                  network_device: { ...prev.network_device, device_type: value as NetworkDeviceType }
                }))}
                placeholder="Select device type"
              />
            </div>
            <div {...withDataAutomationId({ id: 'network-device-ip-container' })}>
              <label className="block text-sm font-medium text-gray-700">Management IP</label>
              <Input
                {...withDataAutomationId({ id: 'network-device-ip-input' })}
                value={formData.network_device.management_ip}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  network_device: { ...prev.network_device, management_ip: e.target.value }
                }))}
                placeholder="e.g., 192.168.1.1"
                required
              />
            </div>
          </>
        );

      case 'server':
        return (
          <>
            <div {...withDataAutomationId({ id: 'server-os-type-container' })}>
              <label className="block text-sm font-medium text-gray-700">OS Type</label>
              <Input
                {...withDataAutomationId({ id: 'server-os-type-input' })}
                value={formData.server.os_type}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  server: { ...prev.server, os_type: e.target.value }
                }))}
                placeholder="e.g., Windows Server, Ubuntu Server"
                required
              />
            </div>
            <div {...withDataAutomationId({ id: 'server-os-version-container' })}>
              <label className="block text-sm font-medium text-gray-700">OS Version</label>
              <Input
                {...withDataAutomationId({ id: 'server-os-version-input' })}
                value={formData.server.os_version}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  server: { ...prev.server, os_version: e.target.value }
                }))}
                placeholder="e.g., 2022, 22.04 LTS"
                required
              />
            </div>
          </>
        );

      case 'mobile_device':
        return (
          <>
            <div {...withDataAutomationId({ id: 'mobile-device-os-type-container' })}>
              <label className="block text-sm font-medium text-gray-700">OS Type</label>
              <CustomSelect
                {...withDataAutomationId({ id: 'mobile-device-os-type-select' })}
                options={[
                  { value: 'ios', label: 'iOS' },
                  { value: 'android', label: 'Android' }
                ]}
                value={formData.mobile_device.os_type}
                onValueChange={(value) => setFormData(prev => ({
                  ...prev,
                  mobile_device: { ...prev.mobile_device, os_type: value }
                }))}
                placeholder="Select OS type"
              />
            </div>
            <div {...withDataAutomationId({ id: 'mobile-device-model-container' })}>
              <label className="block text-sm font-medium text-gray-700">Model</label>
              <Input
                {...withDataAutomationId({ id: 'mobile-device-model-input' })}
                value={formData.mobile_device.model}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  mobile_device: { ...prev.mobile_device, model: e.target.value }
                }))}
                placeholder="e.g., iPhone 14 Pro, Galaxy S23"
                required
              />
            </div>
          </>
        );

      case 'printer':
        return (
          <div {...withDataAutomationId({ id: 'printer-model-container' })}>
            <label className="block text-sm font-medium text-gray-700">Model</label>
            <Input
              {...withDataAutomationId({ id: 'printer-model-input' })}
              value={formData.printer.model}
              onChange={(e) => setFormData(prev => ({
                ...prev,
                printer: { ...prev.printer, model: e.target.value }
              }))}
              placeholder="e.g., HP LaserJet Pro M404n"
              required
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button {...withDataAutomationId({ id: 'quick-add-asset-button' })}>Add Asset</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content {...withDataAutomationId({ id: 'quick-add-asset-content' })} className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[480px]">
          <Dialog.Title className="text-lg font-bold mb-4">Add New Asset</Dialog.Title>
          {error && <div className="text-red-500 mb-4">{error}</div>}
          <form {...withDataAutomationId({ id: 'quick-add-asset-form' })} onSubmit={handleSubmit} className="space-y-4">
            {!companyId && (
              <div {...withDataAutomationId({ id: 'company-picker-container' })}>
                <label className="block text-sm font-medium text-gray-700">Company</label>
                <CompanyPicker
                  {...withDataAutomationId({ id: 'company-picker' })}
                  companies={companies}
                  selectedCompanyId={selectedCompanyId}
                  onSelect={setSelectedCompanyId}
                  filterState="active"
                  onFilterStateChange={() => {}}
                  clientTypeFilter="all"
                  onClientTypeFilterChange={() => {}}
                />
              </div>
            )}

            <div {...withDataAutomationId({ id: 'asset-name-container' })}>
              <label className="block text-sm font-medium text-gray-700">Asset Name</label>
              <Input
                {...withDataAutomationId({ id: 'asset-name-input' })}
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter asset name"
                required
              />
            </div>

            <div {...withDataAutomationId({ id: 'asset-tag-container' })}>
              <label className="block text-sm font-medium text-gray-700">Asset Tag</label>
              <Input
                {...withDataAutomationId({ id: 'asset-tag-input' })}
                value={formData.asset_tag}
                onChange={(e) => setFormData(prev => ({ ...prev, asset_tag: e.target.value }))}
                placeholder="Enter asset tag"
                required
              />
            </div>

            <div {...withDataAutomationId({ id: 'asset-type-container' })}>
              <label className="block text-sm font-medium text-gray-700">Type</label>
              <CustomSelect
                {...withDataAutomationId({ id: 'asset-type-select' })}
                options={ASSET_TYPE_OPTIONS}
                value={formData.asset_type}
                onValueChange={(value) => setFormData(prev => ({ 
                  ...prev, 
                  asset_type: value as AssetType 
                }))}
                placeholder="Select type"
              />
            </div>

            <div {...withDataAutomationId({ id: 'asset-status-container' })}>
              <label className="block text-sm font-medium text-gray-700">Status</label>
              <CustomSelect
                {...withDataAutomationId({ id: 'asset-status-select' })}
                options={STATUS_OPTIONS}
                value={formData.status}
                onValueChange={(value) => setFormData(prev => ({ ...prev, status: value as AssetStatus }))}
                placeholder="Select status"
              />
            </div>

            <div {...withDataAutomationId({ id: 'serial-number-container' })}>
              <label className="block text-sm font-medium text-gray-700">Serial Number</label>
              <Input
                {...withDataAutomationId({ id: 'serial-number-input' })}
                value={formData.serial_number}
                onChange={(e) => setFormData(prev => ({ ...prev, serial_number: e.target.value }))}
                placeholder="Enter serial number"
              />
            </div>

            {formData.asset_type && (
              <div {...withDataAutomationId({ id: 'type-specific-details' })} className="border-t pt-4">
                <h3 className="text-sm font-medium text-gray-700 mb-4">Type-specific Details</h3>
                {renderTypeSpecificFields()}
              </div>
            )}

            <div {...withDataAutomationId({ id: 'form-actions' })} className="flex justify-end space-x-2 pt-4">
              <Button {...withDataAutomationId({ id: 'cancel-button' })} type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button {...withDataAutomationId({ id: 'submit-button' })} type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Asset'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
