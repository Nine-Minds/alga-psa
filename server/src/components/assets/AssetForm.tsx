'use client';

import React, { useState, useEffect } from 'react';
import { Asset, CreateAssetRequest, WorkstationAsset, NetworkDeviceAsset, ServerAsset, MobileDeviceAsset, PrinterAsset } from 'server/src/interfaces/asset.interfaces';
import { Card } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import Spinner from 'server/src/components/ui/Spinner';
import { getAsset, updateAsset } from 'server/src/lib/actions/asset-actions/assetActions';
import { useRouter } from 'next/navigation';
import { Monitor, Network, Server, Smartphone, Printer as PrinterIcon, Router, Shield, Radio, Scale } from 'lucide-react';
import { Text } from '@radix-ui/themes';
import { useRegisterUIComponent } from 'server/src/types/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from 'server/src/types/ui-reflection/withDataAutomationId';

interface AssetFormProps {
  assetId: string;
}

type AssetFormData = Omit<CreateAssetRequest, 'workstation' | 'network_device' | 'server' | 'mobile_device' | 'printer'> & {
  workstation?: Omit<WorkstationAsset, 'tenant' | 'asset_id'>;
  network_device?: Omit<NetworkDeviceAsset, 'tenant' | 'asset_id'>;
  server?: Omit<ServerAsset, 'tenant' | 'asset_id'>;
  mobile_device?: Omit<MobileDeviceAsset, 'tenant' | 'asset_id'>;
  printer?: Omit<PrinterAsset, 'tenant' | 'asset_id'>;
};


const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'maintenance', label: 'Maintenance' }
];

const NETWORK_DEVICE_TYPES = [
  { value: 'switch', label: 'Switch' },
  { value: 'router', label: 'Router' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'access_point', label: 'Access Point' },
  { value: 'load_balancer', label: 'Load Balancer' }
];

const STORAGE_TYPES = [
  { value: 'ssd', label: 'SSD' },
  { value: 'hdd', label: 'HDD' },
  { value: 'nvme', label: 'NVMe' }
];

const OS_TYPES = [
  { value: 'windows', label: 'Windows' },
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' }
];

export default function AssetForm({ assetId }: AssetFormProps) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateForm = useRegisterUIComponent({
    id: 'asset-edit-form',
    type: 'form',
    label: 'Edit Asset',
    disabled: saving
  });
  const [formData, setFormData] = useState<AssetFormData>({
    asset_type: 'unknown',
    client_id: '',
    name: '',
    asset_tag: '',
    serial_number: '',
    status: '',
    location: '',
    purchase_date: '',
    warranty_end_date: ''
  });
  
  const router = useRouter();

  useEffect(() => {
    const loadAsset = async () => {
      try {
        const data = await getAsset(assetId);
        if (!data) {
          setError('Asset not found');
          return;
        }
        setAsset(data);
        
        const purchaseDate = typeof data.purchase_date === 'string' 
          ? data.purchase_date.split('T')[0] 
          : '';
          
        const warrantyEndDate = typeof data.warranty_end_date === 'string'
          ? data.warranty_end_date.split('T')[0]
          : '';
  
        setFormData({
          asset_type: data.asset_type,
          client_id: data.client_id,
          name: data.name || '',
          asset_tag: data.asset_tag || '',
          serial_number: data.serial_number || '',
          status: data.status || 'active',
          location: data.location || '',
          purchase_date: purchaseDate,
          warranty_end_date: warrantyEndDate,
          workstation: data.workstation ? {
            os_type: data.workstation.os_type || '',
            os_version: data.workstation.os_version || '',
            cpu_model: data.workstation.cpu_model || '',
            cpu_cores: data.workstation.cpu_cores || 0,
            ram_gb: data.workstation.ram_gb || 0,
            storage_type: data.workstation.storage_type || '',
            storage_capacity_gb: data.workstation.storage_capacity_gb || 0,
            gpu_model: data.workstation.gpu_model || '',
            installed_software: data.workstation.installed_software || []
          } : undefined,
          network_device: data.network_device ? {
            device_type: data.network_device.device_type || '',
            management_ip: data.network_device.management_ip || '',
            port_count: data.network_device.port_count || 0,
            firmware_version: data.network_device.firmware_version || '',
            supports_poe: data.network_device.supports_poe || false,
            power_draw_watts: data.network_device.power_draw_watts || 0,
            vlan_config: data.network_device.vlan_config || {},
            port_config: data.network_device.port_config || {}
          } : undefined,
          server: data.server ? {
            os_type: data.server.os_type || '',
            os_version: data.server.os_version || '',
            cpu_model: data.server.cpu_model || '',
            cpu_cores: data.server.cpu_cores || 0,
            ram_gb: data.server.ram_gb || 0,
            storage_config: data.server.storage_config || [],
            raid_config: data.server.raid_config || '',
            is_virtual: data.server.is_virtual || false,
            hypervisor: data.server.hypervisor || '',
            network_interfaces: data.server.network_interfaces || [],
            primary_ip: data.server.primary_ip || '',
            installed_services: data.server.installed_services || []
          } : undefined,
          mobile_device: data.mobile_device ? {
            os_type: data.mobile_device.os_type || '',
            os_version: data.mobile_device.os_version || '',
            model: data.mobile_device.model || '',
            imei: data.mobile_device.imei || '',
            phone_number: data.mobile_device.phone_number || '',
            carrier: data.mobile_device.carrier || '',
            is_supervised: data.mobile_device.is_supervised || false,
            installed_apps: data.mobile_device.installed_apps || []
          } : undefined,
          printer: data.printer ? {
            model: data.printer.model || '',
            ip_address: data.printer.ip_address || '',
            is_network_printer: data.printer.is_network_printer || false,
            supports_color: data.printer.supports_color || false,
            supports_duplex: data.printer.supports_duplex || false,
            max_paper_size: data.printer.max_paper_size || 0,
            supported_paper_types: data.printer.supported_paper_types || [],
            monthly_duty_cycle: data.printer.monthly_duty_cycle || 0,
            supply_levels: data.printer.supply_levels || {}
          } : undefined
        });
      } catch (error) {
        console.error('Error loading asset:', error);
        setError('Failed to load asset details');
      } finally {
        setLoading(false);
      }
    };
  
    loadAsset();
  }, [assetId]);

  const getAssetTypeIcon = () => {
    const iconClass = "h-16 w-16 text-primary-500 mb-4";
    
    if (asset?.workstation) return <Monitor className={iconClass} />;
    if (asset?.network_device) {
      switch (asset.network_device.device_type) {
        case 'switch': return <Network className={iconClass} />;
        case 'router': return <Router className={iconClass} />;
        case 'firewall': return <Shield className={iconClass} />;
        case 'access_point': return <Radio className={iconClass} />;
        case 'load_balancer': return <Scale className={iconClass} />;
        default: return <Network className={iconClass} />;
      }
    }
    if (asset?.server) return <Server className={iconClass} />;
    if (asset?.mobile_device) return <Smartphone className={iconClass} />;
    if (asset?.printer) return <PrinterIcon className={iconClass} />;
    return null;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleTypeSpecificChange = (type: keyof AssetFormData, field: string, value: unknown) => {
    setFormData(prev => {
      const currentTypeData = prev[type];
      if (!currentTypeData) return prev;

      // Type guard to ensure we're working with an object
      if (typeof currentTypeData !== 'object') return prev;

      // Special handling for network device type
      if (type === 'network_device' && field === 'device_type') {
        const deviceType = String(value);
        const validDeviceTypes = ['switch', 'router', 'firewall', 'access_point', 'load_balancer'] as const;
        type DeviceType = typeof validDeviceTypes[number];

        const isValidDeviceType = (type: string): type is DeviceType =>
          validDeviceTypes.includes(type as DeviceType);

        const validDeviceType = isValidDeviceType(deviceType) ? deviceType : 'switch';

        return {
          ...prev,
          network_device: {
            ...currentTypeData,
            device_type: validDeviceType
          }
        } as AssetFormData;
      }

      // Handle other fields
      return {
        ...prev,
        [type]: {
          ...currentTypeData,
          [field]: value
        }
      } as AssetFormData;
    });
  };
  const handleSelectChange = (value: string, field: keyof AssetFormData = 'status') => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const renderWorkstationFields = () => {
    if (!asset?.workstation) return null;
    if (!formData.workstation) return null;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            OS Type
          </label>
          <CustomSelect
            value={formData.workstation.os_type || ''}
            onValueChange={(value) => handleTypeSpecificChange('workstation', 'os_type', value)}
            options={OS_TYPES}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            OS Version
          </label>
          <Input
            value={formData.workstation.os_version || ''}
            onChange={(e) => handleTypeSpecificChange('workstation', 'os_version', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            CPU Model
          </label>
          <Input
            value={formData.workstation.cpu_model || ''}
            onChange={(e) => handleTypeSpecificChange('workstation', 'cpu_model', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            CPU Cores
          </label>
          <Input
            type="number"
            value={formData.workstation.cpu_cores || ''}
            onChange={(e) => handleTypeSpecificChange('workstation', 'cpu_cores', parseInt(e.target.value))}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            RAM (GB)
          </label>
          <Input
            type="number"
            value={formData.workstation.ram_gb || ''}
            onChange={(e) => handleTypeSpecificChange('workstation', 'ram_gb', parseInt(e.target.value))}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Storage Type
          </label>
          <CustomSelect
            value={formData.workstation.storage_type || ''}
            onValueChange={(value) => handleTypeSpecificChange('workstation', 'storage_type', value)}
            options={STORAGE_TYPES}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Storage Capacity (GB)
          </label>
          <Input
            type="number"
            value={formData.workstation.storage_capacity_gb || ''}
            onChange={(e) => handleTypeSpecificChange('workstation', 'storage_capacity_gb', parseInt(e.target.value))}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            GPU Model
          </label>
          <Input
            value={formData.workstation.gpu_model || ''}
            onChange={(e) => handleTypeSpecificChange('workstation', 'gpu_model', e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
    );
  };

  const renderNetworkDeviceFields = () => {
    if (!asset?.network_device) return null;
    if (!formData.network_device) return null;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Device Type
          </label>
          <CustomSelect
            value={formData.network_device.device_type || ''}
            onValueChange={(value) => handleTypeSpecificChange('network_device', 'device_type', value)}
            options={NETWORK_DEVICE_TYPES}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Management IP
          </label>
          <Input
            value={formData.network_device.management_ip || ''}
            onChange={(e) => handleTypeSpecificChange('network_device', 'management_ip', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Port Count
          </label>
          <Input
            type="number"
            value={formData.network_device.port_count || ''}
            onChange={(e) => handleTypeSpecificChange('network_device', 'port_count', parseInt(e.target.value))}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Firmware Version
          </label>
          <Input
            value={formData.network_device.firmware_version || ''}
            onChange={(e) => handleTypeSpecificChange('network_device', 'firmware_version', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Power Draw (Watts)
          </label>
          <Input
            type="number"
            value={formData.network_device.power_draw_watts || ''}
            onChange={(e) => handleTypeSpecificChange('network_device', 'power_draw_watts', parseInt(e.target.value))}
            className="mt-1"
          />
        </div>
        <div className="flex items-center">
          <Checkbox
            id="supports-poe"
            label="Supports PoE"
            checked={formData.network_device.supports_poe || false}
            onChange={(e) => handleTypeSpecificChange('network_device', 'supports_poe', (e.target as HTMLInputElement).checked)}
          />
        </div>
      </div>
    );
  };

  const renderServerFields = () => {
    if (!asset?.server) return null;
    if (!formData.server) return null;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            OS Type
          </label>
          <CustomSelect
            value={formData.server.os_type || ''}
            onValueChange={(value) => handleTypeSpecificChange('server', 'os_type', value)}
            options={OS_TYPES}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            OS Version
          </label>
          <Input
            value={formData.server.os_version || ''}
            onChange={(e) => handleTypeSpecificChange('server', 'os_version', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            CPU Model
          </label>
          <Input
            value={formData.server.cpu_model || ''}
            onChange={(e) => handleTypeSpecificChange('server', 'cpu_model', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            CPU Cores
          </label>
          <Input
            type="number"
            value={formData.server.cpu_cores || ''}
            onChange={(e) => handleTypeSpecificChange('server', 'cpu_cores', parseInt(e.target.value))}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            RAM (GB)
          </label>
          <Input
            type="number"
            value={formData.server.ram_gb || ''}
            onChange={(e) => handleTypeSpecificChange('server', 'ram_gb', parseInt(e.target.value))}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Primary IP
          </label>
          <Input
            value={formData.server.primary_ip || ''}
            onChange={(e) => handleTypeSpecificChange('server', 'primary_ip', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            RAID Config
          </label>
          <Input
            value={formData.server.raid_config || ''}
            onChange={(e) => handleTypeSpecificChange('server', 'raid_config', e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="flex items-center">
          <Checkbox
            id="is-virtual"
            label="Virtual Machine"
            checked={formData.server.is_virtual || false}
            onChange={(e) => handleTypeSpecificChange('server', 'is_virtual', (e.target as HTMLInputElement).checked)}
          />
        </div>
        {formData.server.is_virtual && (
          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
              Hypervisor
            </label>
            <Input
              value={formData.server.hypervisor || ''}
              onChange={(e) => handleTypeSpecificChange('server', 'hypervisor', e.target.value)}
              className="mt-1"
            />
          </div>
        )}
      </div>
    );
  };

  const renderMobileDeviceFields = () => {
    if (!asset?.mobile_device) return null;
    if (!formData.mobile_device) return null;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            OS Type
          </label>
          <CustomSelect
            value={formData.mobile_device.os_type || ''}
            onValueChange={(value) => handleTypeSpecificChange('mobile_device', 'os_type', value)}
            options={[
              { value: 'ios', label: 'iOS' },
              { value: 'android', label: 'Android' }
            ]}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            OS Version
          </label>
          <Input
            value={formData.mobile_device.os_version || ''}
            onChange={(e) => handleTypeSpecificChange('mobile_device', 'os_version', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Model
          </label>
          <Input
            value={formData.mobile_device.model || ''}
            onChange={(e) => handleTypeSpecificChange('mobile_device', 'model', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            IMEI
          </label>
          <Input
            value={formData.mobile_device.imei || ''}
            onChange={(e) => handleTypeSpecificChange('mobile_device', 'imei', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Phone Number
          </label>
          <Input
            value={formData.mobile_device.phone_number || ''}
            onChange={(e) => handleTypeSpecificChange('mobile_device', 'phone_number', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Carrier
          </label>
          <Input
            value={formData.mobile_device.carrier || ''}
            onChange={(e) => handleTypeSpecificChange('mobile_device', 'carrier', e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="flex items-center">
          <Checkbox
            id="is-supervised"
            label="Supervised Device"
            checked={formData.mobile_device.is_supervised || false}
            onChange={(e) => handleTypeSpecificChange('mobile_device', 'is_supervised', (e.target as HTMLInputElement).checked)}
          />
        </div>
      </div>
    );
  };

  const renderPrinterFields = () => {
    if (!asset?.printer) return null;
    if (!formData.printer) return null;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Model
          </label>
          <Input
            value={formData.printer.model || ''}
            onChange={(e) => handleTypeSpecificChange('printer', 'model', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            IP Address
          </label>
          <Input
            value={formData.printer.ip_address || ''}
            onChange={(e) => handleTypeSpecificChange('printer', 'ip_address', e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Monthly Duty Cycle
          </label>
          <Input
            type="number"
            value={formData.printer.monthly_duty_cycle || ''}
            onChange={(e) => handleTypeSpecificChange('printer', 'monthly_duty_cycle', parseInt(e.target.value))}
            className="mt-1"
          />
        </div>
        <div className="flex items-center space-x-6">
          <Checkbox
            id="is-network-printer"
            label="Network Printer"
            checked={formData.printer.is_network_printer || false}
            onChange={(e) => handleTypeSpecificChange('printer', 'is_network_printer', (e.target as HTMLInputElement).checked)}
          />
          <Checkbox
            id="supports-color"
            label="Color Support"
            checked={formData.printer.supports_color || false}
            onChange={(e) => handleTypeSpecificChange('printer', 'supports_color', (e.target as HTMLInputElement).checked)}
          />
          <Checkbox
            id="supports-duplex"
            label="Duplex Support"
            checked={formData.printer.supports_duplex || false}
            onChange={(e) => handleTypeSpecificChange('printer', 'supports_duplex', (e.target as HTMLInputElement).checked)}
          />
        </div>
      </div>
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!asset) return;

    setSaving(true);
    setError(null);

    try {
      // Format the data before sending
      const formattedData = {
        ...formData,
        // Convert dates to ISO strings if they exist, otherwise undefined
        purchase_date: formData.purchase_date 
          ? new Date(formData.purchase_date + 'T00:00:00Z').toISOString()
          : undefined,
        warranty_end_date: formData.warranty_end_date
          ? new Date(formData.warranty_end_date + 'T00:00:00Z').toISOString()
          : undefined,
        // Ensure optional fields are undefined instead of empty strings
        location: formData.location?.trim() || undefined,
        serial_number: formData.serial_number?.trim() || undefined,
      };

      // Format workstation data if it exists
      if (formData.workstation) {
        formattedData.workstation = {
          ...formData.workstation,
          os_type: formData.workstation.os_type?.trim(),
          os_version: formData.workstation.os_version?.trim(),
          cpu_model: formData.workstation.cpu_model?.trim(),
          storage_type: formData.workstation.storage_type?.trim(),
          gpu_model: formData.workstation.gpu_model?.trim() || undefined,
          installed_software: Array.isArray(formData.workstation.installed_software) 
            ? formData.workstation.installed_software 
            : []
        };
      }

      // Format network device data if it exists
      if (formData.network_device) {
        const deviceType = formData.network_device.device_type?.trim();
        // Type guard for network device type
        const isValidDeviceType = (type: string): type is NetworkDeviceAsset['device_type'] =>
          ['switch', 'router', 'firewall', 'access_point', 'load_balancer'].includes(type);

        // Validate device type
        const validDeviceType = isValidDeviceType(deviceType) ? deviceType : 'switch';

        formattedData.network_device = {
          ...formData.network_device,
          device_type: validDeviceType,
          management_ip: formData.network_device.management_ip?.trim(),
          firmware_version: formData.network_device.firmware_version?.trim(),
          vlan_config: formData.network_device.vlan_config || {},
          port_config: formData.network_device.port_config || {}
        };
      }

      // Format server data if it exists
      if (formData.server) {
        formattedData.server = {
          ...formData.server,
          os_type: formData.server.os_type?.trim(),
          os_version: formData.server.os_version?.trim(),
          cpu_model: formData.server.cpu_model?.trim(),
          storage_config: Array.isArray(formData.server.storage_config) 
            ? formData.server.storage_config 
            : [],
          raid_config: formData.server.raid_config?.trim() || undefined,
          hypervisor: formData.server.hypervisor?.trim() || undefined,
          network_interfaces: Array.isArray(formData.server.network_interfaces) 
            ? formData.server.network_interfaces 
            : [],
          primary_ip: formData.server.primary_ip?.trim() || undefined,
          installed_services: Array.isArray(formData.server.installed_services) 
            ? formData.server.installed_services 
            : []
        };
      }

      // Format mobile device data if it exists
      if (formData.mobile_device) {
        formattedData.mobile_device = {
          ...formData.mobile_device,
          os_type: formData.mobile_device.os_type?.trim(),
          os_version: formData.mobile_device.os_version?.trim(),
          model: formData.mobile_device.model?.trim(),
          imei: formData.mobile_device.imei?.trim() || undefined,
          phone_number: formData.mobile_device.phone_number?.trim() || undefined,
          carrier: formData.mobile_device.carrier?.trim() || undefined,
          installed_apps: Array.isArray(formData.mobile_device.installed_apps) 
            ? formData.mobile_device.installed_apps 
            : []
        };
      }

      // Format printer data if it exists
      if (formData.printer) {
        formattedData.printer = {
          ...formData.printer,
          model: formData.printer.model?.trim(),
          ip_address: formData.printer.ip_address?.trim() || undefined,
          supported_paper_types: Array.isArray(formData.printer.supported_paper_types) 
            ? formData.printer.supported_paper_types 
            : [],
          supply_levels: formData.printer.supply_levels || {}
        };
      }

      // Remove any undefined or empty string values from the root object
      const cleanedData = Object.fromEntries(
        Object.entries(formattedData).filter(([_, value]) => 
          value !== undefined && value !== ''
        )
      );

      await updateAsset(assetId, formattedData);
      router.push(`/msp/assets/${assetId}`);
      router.refresh();
    } catch (error) {
      console.error('Error updating asset:', error);
      setError('Failed to update asset');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div id="asset-form-loading" className="flex min-h-[400px] items-center justify-center">
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-4 py-2 text-sm text-gray-500">
          <Spinner size="sm" className="text-primary-500" />
          Loading asset details...
        </div>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div id="asset-form-error" className="flex items-center justify-center min-h-[400px]">
        <div className="text-red-500">{error || 'Asset not found'}</div>
      </div>
    );
  }

  return (
    <div id="asset-form-container" className="space-y-6">
      <div id="asset-form-header" className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[rgb(var(--color-text-900))]">Edit Asset</h1>
      </div>

      <form id="asset-edit-form" onSubmit={handleSubmit} className="space-y-6">
        <Card id="basic-info-section" className="p-6 border border-[rgb(var(--color-border-200))]">
          <div id="asset-type-icon" className="flex flex-col items-center mb-6">
            {getAssetTypeIcon()}
            <Text size="5" weight="medium" className="text-[rgb(var(--color-text-900))]">
              Basic Information
            </Text>
          </div>

          <div id="basic-info-fields-grid" className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div id="basic-info-left-column" className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
                  Name
                </label>
                <Input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  className="mt-1"
                />
                </div>
              </div>

          <div>
            <label className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
            Asset Tag
                </label>
                <Input
                  id="asset_tag"
                  name="asset_tag"
                  value={formData.asset_tag}
                  onChange={handleInputChange}
                  required
                  className="mt-1"
                />
              </div>

              <div>
                <label htmlFor="serial_number" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
                  Serial Number
                </label>
                <Input
                  id="serial_number"
                  name="serial_number"
                  value={formData.serial_number}
                  onChange={handleInputChange}
                  className="mt-1"
                />
              </div>

              <div>
                <label htmlFor="status" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
              Status
            </label>
            <CustomSelect
              id="status-select"
              value={formData.status}
              onValueChange={handleSelectChange}
              options={STATUS_OPTIONS}
              className="mt-1"
            />
          </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="location" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
                  Location
                </label>
                <Input
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={handleInputChange}
                  className="mt-1"
                />
              </div>

              <div>
                <label htmlFor="purchase_date" className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  Purchase Date
                </label>
                <DatePicker
                  id="purchase_date"
                  value={formData.purchase_date ? new Date(formData.purchase_date) : undefined}
                  onChange={(date) => {
                    setFormData(prev => ({
                      ...prev,
                      purchase_date: date ? date.toISOString().split('T')[0] : ''
                    }));
                  }}
                  placeholder="Select purchase date"
                />
              </div>

              <div>
                <label htmlFor="warranty_end_date" className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  Warranty End Date
                </label>
                <DatePicker
                  id="warranty_end_date"
                  value={formData.warranty_end_date ? new Date(formData.warranty_end_date) : undefined}
                  onChange={(date) => {
                    setFormData(prev => ({
                      ...prev,
                      warranty_end_date: date ? date.toISOString().split('T')[0] : ''
                    }));
                  }}
                  placeholder="Select warranty end date"
                />
              </div>
            </div>
          </div>
        </Card>

        {(asset.workstation || asset.network_device || asset.server || asset.mobile_device || asset.printer) && (
          <Card id="type-specific-details" className="p-6 border border-[rgb(var(--color-border-200))]">
            <Text size="5" weight="medium" className="block mb-6 text-[rgb(var(--color-text-900))]">
              {asset.workstation ? 'Workstation Details' :
                asset.network_device ? 'Network Device Details' :
                asset.server ? 'Server Details' :
                asset.mobile_device ? 'Mobile Device Details' :
                'Printer Details'}
            </Text>
            {asset.workstation && renderWorkstationFields()}
            {asset.network_device && renderNetworkDeviceFields()}
            {asset.server && renderServerFields()}
            {asset.mobile_device && renderMobileDeviceFields()}
            {asset.printer && renderPrinterFields()}
          </Card>
        )}

        <div id="form-actions" className="flex justify-end gap-4">
          <Button
            id="cancel-button"
            type="button"
            variant="outline" 
            onClick={() => router.back()}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            id="save-button"
            type="submit"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

        {error && (
          <div id="form-error" className="text-red-500 text-sm mt-2">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
