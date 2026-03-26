'use client';

import React, { useState, useEffect } from 'react';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { createAsset } from '../actions/assetActions';
import type { CreateAssetRequest, IClient } from '@alga-psa/types';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { getAllClientsForAssets } from '../actions/clientLookupActions';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface QuickAddAssetProps {
  clientId?: string;
  onAssetAdded: () => void;
  onClose?: () => void;
  defaultOpen?: boolean;
}

type NetworkDeviceType = 'switch' | 'router' | 'firewall' | 'access_point' | 'load_balancer';
type AssetStatus = 'active' | 'inactive' | 'maintenance';
type AssetType = 'workstation' | 'network_device' | 'server' | 'mobile_device' | 'printer';

const STATUS_OPTION_VALUES: AssetStatus[] = ['active', 'inactive', 'maintenance'];
const ASSET_TYPE_OPTION_VALUES: AssetType[] = ['workstation', 'network_device', 'server', 'mobile_device', 'printer'];

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

export function QuickAddAsset({ clientId, onAssetAdded, onClose, defaultOpen = false }: QuickAddAssetProps) {
  const { t } = useTranslation('msp/assets');
  const { renderQuickAddClient } = useQuickAddClient();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<IClient[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(clientId || null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const statusOptions: SelectOption[] = STATUS_OPTION_VALUES.map((value) => ({
    value,
    label: t(`quickAddAsset.statusOptions.${value}`, {
      defaultValue: value.charAt(0).toUpperCase() + value.slice(1)
    })
  }));
  const assetTypeOptions: SelectOption[] = ASSET_TYPE_OPTION_VALUES.map((value) => ({
    value,
    label: t(`quickAddAsset.assetTypes.${value}`, {
      defaultValue: value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    })
  }));

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

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
    if (defaultOpen) {
      setOpen(true);
    }
  }, [defaultOpen]);

  useEffect(() => {
    const fetchClients = async () => {
      try {
        if (!clientId) {
          const clientsData = await getAllClientsForAssets(false);
          setClients(clientsData);
        }
      } catch (error) {
        console.error('Error fetching clients:', error);
        setError(t('quickAddAsset.errors.fetchClientsFailed', {
          defaultValue: 'Failed to fetch clients'
        }));
      }
    };
    if (open) {
      fetchClients();
    }
  }, [open, clientId, t]);

  const validateForm = () => {
    const validationErrors: string[] = [];
    const effectiveClientId = clientId || selectedClientId;
    if (!effectiveClientId) validationErrors.push(t('quickAddAsset.validation.client', { defaultValue: 'Client' }));
    if (!formData.name.trim()) validationErrors.push(t('quickAddAsset.validation.assetName', { defaultValue: 'Asset Name' }));
    if (!formData.asset_tag.trim()) validationErrors.push(t('quickAddAsset.validation.assetTag', { defaultValue: 'Asset Tag' }));
    if (!formData.asset_type) validationErrors.push(t('quickAddAsset.validation.assetType', { defaultValue: 'Asset Type' }));
    return validationErrors;
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setError(null);
    }
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
      const effectiveClientId = clientId || selectedClientId;

      if (!formData.asset_type) {
        return; // This should never happen due to validation
      }

      if (!effectiveClientId) {
        return; // This should never happen due to validation
      }

      const assetData: CreateAssetRequest = {
        asset_type: formData.asset_type,
        client_id: effectiveClientId,
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
      handleClose();
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
      if (!clientId) {
        setSelectedClientId(null);
      }
      setHasAttemptedSubmit(false);
    } catch (error) {
      console.error('Error creating asset:', error);
      setError(error instanceof Error
        ? error.message
        : t('quickAddAsset.errors.createFailed', { defaultValue: 'Failed to create asset' }));
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
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.osType', { defaultValue: 'OS Type' })}
              </label>
              <Input
                {...withDataAutomationId({ id: 'workstation-os-type-input' })}
                value={formData.workstation.os_type}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  workstation: { ...prev.workstation, os_type: e.target.value }
                }))}
                placeholder={t('quickAddAsset.placeholders.workstationOsType', {
                  defaultValue: 'e.g., Windows, macOS, Linux'
                })}
              />
            </div>
            <div {...withDataAutomationId({ id: 'workstation-os-version-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.osVersion', { defaultValue: 'OS Version' })}
              </label>
              <Input
                {...withDataAutomationId({ id: 'workstation-os-version-input' })}
                value={formData.workstation.os_version}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  workstation: { ...prev.workstation, os_version: e.target.value }
                }))}
                placeholder={t('quickAddAsset.placeholders.workstationOsVersion', {
                  defaultValue: 'e.g., 11, Monterey, Ubuntu 22.04'
                })}
              />
            </div>
          </>
        );

      case 'network_device':
        return (
          <>
            <div {...withDataAutomationId({ id: 'network-device-type-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.deviceType', { defaultValue: 'Device Type' })}
              </label>
              <CustomSelect
                {...withDataAutomationId({ id: 'network-device-type-select' })}
                options={[
                  { value: 'switch', label: t('quickAddAsset.networkDeviceTypes.switch', { defaultValue: 'Switch' }) },
                  { value: 'router', label: t('quickAddAsset.networkDeviceTypes.router', { defaultValue: 'Router' }) },
                  { value: 'firewall', label: t('quickAddAsset.networkDeviceTypes.firewall', { defaultValue: 'Firewall' }) },
                  { value: 'access_point', label: t('quickAddAsset.networkDeviceTypes.accessPoint', { defaultValue: 'Access Point' }) },
                  { value: 'load_balancer', label: t('quickAddAsset.networkDeviceTypes.loadBalancer', { defaultValue: 'Load Balancer' }) }
                ]}
                value={formData.network_device.device_type}
                onValueChange={(value) => setFormData(prev => ({
                  ...prev,
                  network_device: { ...prev.network_device, device_type: value as NetworkDeviceType }
                }))}
                placeholder={t('quickAddAsset.placeholders.selectDeviceType', {
                  defaultValue: 'Select device type'
                })}
              />
            </div>
            <div {...withDataAutomationId({ id: 'network-device-ip-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.managementIp', { defaultValue: 'Management IP' })}
              </label>
              <Input
                {...withDataAutomationId({ id: 'network-device-ip-input' })}
                value={formData.network_device.management_ip}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  network_device: { ...prev.network_device, management_ip: e.target.value }
                }))}
                placeholder={t('quickAddAsset.placeholders.managementIp', {
                  defaultValue: 'e.g., 192.168.1.1'
                })}
              />
            </div>
          </>
        );

      case 'server':
        return (
          <>
            <div {...withDataAutomationId({ id: 'server-os-type-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.osType', { defaultValue: 'OS Type' })}
              </label>
              <Input
                {...withDataAutomationId({ id: 'server-os-type-input' })}
                value={formData.server.os_type}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  server: { ...prev.server, os_type: e.target.value }
                }))}
                placeholder={t('quickAddAsset.placeholders.serverOsType', {
                  defaultValue: 'e.g., Windows Server, Ubuntu Server'
                })}
              />
            </div>
            <div {...withDataAutomationId({ id: 'server-os-version-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.osVersion', { defaultValue: 'OS Version' })}
              </label>
              <Input
                {...withDataAutomationId({ id: 'server-os-version-input' })}
                value={formData.server.os_version}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  server: { ...prev.server, os_version: e.target.value }
                }))}
                placeholder={t('quickAddAsset.placeholders.serverOsVersion', {
                  defaultValue: 'e.g., 2022, 22.04 LTS'
                })}
              />
            </div>
          </>
        );

      case 'mobile_device':
        return (
          <>
            <div {...withDataAutomationId({ id: 'mobile-device-os-type-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.osType', { defaultValue: 'OS Type' })}
              </label>
              <CustomSelect
                {...withDataAutomationId({ id: 'mobile-device-os-type-select' })}
                options={[
                  { value: 'ios', label: t('quickAddAsset.mobileOsTypes.ios', { defaultValue: 'iOS' }) },
                  { value: 'android', label: t('quickAddAsset.mobileOsTypes.android', { defaultValue: 'Android' }) }
                ]}
                value={formData.mobile_device.os_type}
                onValueChange={(value) => setFormData(prev => ({
                  ...prev,
                  mobile_device: { ...prev.mobile_device, os_type: value }
                }))}
                placeholder={t('quickAddAsset.placeholders.selectOsType', {
                  defaultValue: 'Select OS type'
                })}
              />
            </div>
            <div {...withDataAutomationId({ id: 'mobile-device-model-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.model', { defaultValue: 'Model' })}
              </label>
              <Input
                {...withDataAutomationId({ id: 'mobile-device-model-input' })}
                value={formData.mobile_device.model}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  mobile_device: { ...prev.mobile_device, model: e.target.value }
                }))}
                placeholder={t('quickAddAsset.placeholders.mobileModel', {
                  defaultValue: 'e.g., iPhone 14 Pro, Galaxy S23'
                })}
              />
            </div>
          </>
        );

      case 'printer':
        return (
          <div {...withDataAutomationId({ id: 'printer-model-container' })}>
            <label className="block text-sm font-medium text-gray-700">
              {t('quickAddAsset.fields.model', { defaultValue: 'Model' })}
            </label>
            <Input
              {...withDataAutomationId({ id: 'printer-model-input' })}
              value={formData.printer.model}
              onChange={(e) => setFormData(prev => ({
                ...prev,
                printer: { ...prev.printer, model: e.target.value }
              }))}
              placeholder={t('quickAddAsset.placeholders.printerModel', {
                defaultValue: 'e.g., HP LaserJet Pro M404n'
              })}
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <Button {...withDataAutomationId({ id: 'quick-add-asset-button' })} onClick={() => setOpen(true)}>
        {t('quickAddAsset.actions.addAsset', { defaultValue: 'Add Asset' })}
      </Button>
      
      <Dialog
        isOpen={open}
        onClose={handleClose}
        title={t('quickAddAsset.title', { defaultValue: 'Add New Asset' })}
        className="max-w-[480px] max-h-[90vh] overflow-y-auto"
        id="quick-add-asset"
        disableFocusTrap
      >
        <DialogContent>
          {hasAttemptedSubmit && error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                <p className="font-medium mb-2">
                  {t('quickAddAsset.validation.requiredFields', {
                    defaultValue: 'Please fill in the required fields:'
                  })}
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {error.split('\n').map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {!clientId && (
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('quickAddAsset.fields.clientRequired', { defaultValue: 'Client *' })}
                </label>
                <div className={hasAttemptedSubmit && !selectedClientId ? 'ring-1 ring-red-500 rounded-lg' : ''}>
                  <ClientPicker
                    {...withDataAutomationId({ id: 'client-picker' })}
                    clients={clients}
                    selectedClientId={selectedClientId}
                    onSelect={(id) => {
                      setSelectedClientId(id);
                      clearErrorIfSubmitted();
                    }}
                    filterState={clientFilterState}
                    onFilterStateChange={setClientFilterState}
                    clientTypeFilter={clientTypeFilter}
                    onClientTypeFilterChange={setClientTypeFilter}
                    onAddNew={() => setIsQuickAddClientOpen(true)}
                  />
                </div>
              </div>
            )}

            <div {...withDataAutomationId({ id: 'asset-name-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.assetNameRequired', { defaultValue: 'Asset Name *' })}
              </label>
              <Input
                {...withDataAutomationId({ id: 'asset-name-input' })}
                value={formData.name}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, name: e.target.value }));
                  clearErrorIfSubmitted();
                }}
                placeholder={t('quickAddAsset.placeholders.assetName', {
                  defaultValue: 'Enter asset name'
                })}
                className={hasAttemptedSubmit && !formData.name.trim() ? 'border-red-500' : ''}
                required
              />
            </div>

            <div {...withDataAutomationId({ id: 'asset-tag-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.assetTagRequired', { defaultValue: 'Asset Tag *' })}
              </label>
              <Input
                {...withDataAutomationId({ id: 'asset-tag-input' })}
                value={formData.asset_tag}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, asset_tag: e.target.value }));
                  clearErrorIfSubmitted();
                }}
                placeholder={t('quickAddAsset.placeholders.assetTag', {
                  defaultValue: 'Enter asset tag'
                })}
                className={hasAttemptedSubmit && !formData.asset_tag.trim() ? 'border-red-500' : ''}
                required
              />
            </div>

            <div {...withDataAutomationId({ id: 'asset-type-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.typeRequired', { defaultValue: 'Type *' })}
              </label>
              <CustomSelect
                {...withDataAutomationId({ id: 'asset-type-select' })}
                options={assetTypeOptions}
                value={formData.asset_type}
                onValueChange={(value) => {
                  setFormData(prev => ({ 
                    ...prev, 
                    asset_type: value as AssetType 
                  }));
                  clearErrorIfSubmitted();
                }}
                placeholder={t('quickAddAsset.placeholders.selectType', {
                  defaultValue: 'Select type'
                })}
                className={hasAttemptedSubmit && !formData.asset_type ? 'border-red-500' : ''}
              />
            </div>

            <div {...withDataAutomationId({ id: 'asset-status-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.status', { defaultValue: 'Status' })}
              </label>
              <CustomSelect
                {...withDataAutomationId({ id: 'asset-status-select' })}
                options={statusOptions}
                value={formData.status}
                onValueChange={(value) => setFormData(prev => ({ ...prev, status: value as AssetStatus }))}
                placeholder={t('quickAddAsset.placeholders.selectStatus', {
                  defaultValue: 'Select status'
                })}
              />
            </div>

            <div {...withDataAutomationId({ id: 'serial-number-container' })}>
              <label className="block text-sm font-medium text-gray-700">
                {t('quickAddAsset.fields.serialNumber', { defaultValue: 'Serial Number' })}
              </label>
              <Input
                {...withDataAutomationId({ id: 'serial-number-input' })}
                value={formData.serial_number}
                onChange={(e) => setFormData(prev => ({ ...prev, serial_number: e.target.value }))}
                placeholder={t('quickAddAsset.placeholders.serialNumber', {
                  defaultValue: 'Enter serial number'
                })}
              />
            </div>

            {formData.asset_type && (
              <div {...withDataAutomationId({ id: 'type-specific-details' })} className="border-t pt-4">
                <h3 className="text-sm font-medium text-gray-700 mb-4">
                  {t('quickAddAsset.sections.typeSpecificDetails', {
                    defaultValue: 'Type-specific Details'
                  })}
                </h3>
                {renderTypeSpecificFields()}
              </div>
            )}

            <div {...withDataAutomationId({ id: 'form-actions' })} className="flex justify-end space-x-2 pt-4">
              <Button {...withDataAutomationId({ id: 'cancel-button' })} type="button" variant="outline" onClick={handleClose}>
                {t('common.actions.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button 
                {...withDataAutomationId({ id: 'submit-button' })} 
                type="submit" 
                disabled={isSubmitting}
                className={(!formData.name.trim() || !formData.asset_tag.trim() || !formData.asset_type || (!clientId && !selectedClientId)) && !isSubmitting ? 'opacity-50' : ''}
              >
                {isSubmitting
                  ? t('quickAddAsset.actions.creating', { defaultValue: 'Creating...' })
                  : t('quickAddAsset.actions.createAsset', { defaultValue: 'Create Asset' })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {renderQuickAddClient({
        open: isQuickAddClientOpen,
        onOpenChange: setIsQuickAddClientOpen,
        onClientAdded: (newClient) => {
          setClients(prev => [...prev, newClient]);
          setSelectedClientId(newClient.client_id);
        },
        skipSuccessDialog: true,
      })}
    </>
  );
}
