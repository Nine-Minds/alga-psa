'use client';

import React from 'react';
import { Card, Flex, Text, Heading } from '@radix-ui/themes';
import type { Asset, AssetMaintenanceReport, AssetRelationship, NetworkDeviceAsset } from '@alga-psa/types';
import { getAssetMaintenanceReport } from '../actions/assetActions';
import { Button } from '@alga-psa/ui/components/Button';
import Spinner from '@alga-psa/ui/components/Spinner';
import Link from 'next/link';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { useRegisterUIComponent } from '@alga-psa/ui/ui-reflection/useRegisterUIComponent';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  Edit,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Monitor,
  Network,
  Server,
  HardDrive,
  Cpu,
  CircuitBoard,
  Wifi,
  Gauge,
  Power,
  Database,
  Cloud,
  Signal,
  Palette,
  RotateCw,
  Router,
  Shield,
  Radio,
  Scale,
  Smartphone as PhoneIcon,
  AppWindow,
  Printer,
  FileStack,
  Layers,
  Fingerprint
} from 'lucide-react';
import CreateTicketFromAssetButton from './CreateTicketFromAssetButton';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import DeleteAssetButton from './DeleteAssetButton';
import { Badge } from '@alga-psa/ui/components/Badge';

interface AssetDetailsProps {
  asset: Asset;
  maintenanceReport?: AssetMaintenanceReport | null;
}

export default function AssetDetails({ asset, maintenanceReport: initialMaintenanceReport }: AssetDetailsProps) {
  const { t } = useTranslation('msp/assets');
  const { renderDocuments } = useDocumentsCrossFeature();
  useRegisterUIComponent({
    id: 'asset-details',
    type: 'container',
    label: t('assetDetails.title', { defaultValue: 'Asset Details' })
  });

  const [maintenanceReport, setMaintenanceReport] = React.useState<AssetMaintenanceReport | null>(initialMaintenanceReport || null);
  const [isLoading, setIsLoading] = React.useState(!initialMaintenanceReport);

  const toTitleCase = (value: string) =>
    value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());

  const getAssetStatusLabel = (status: Asset['status']) =>
    t(`assetDetails.statuses.${status}`, { defaultValue: toTitleCase(status) });

  const getDeviceTypeLabel = (deviceType: NetworkDeviceAsset['device_type']) =>
    t(`assetDetails.deviceTypes.${deviceType}`, { defaultValue: toTitleCase(deviceType) });

  const getRelationshipLabel = (relationshipType: AssetRelationship['relationship_type']) =>
    t(`assetDetails.relationshipTypes.${relationshipType}`, {
      defaultValue: toTitleCase(relationshipType)
    });

  React.useEffect(() => {
    if (initialMaintenanceReport) {
      setMaintenanceReport(initialMaintenanceReport);
      setIsLoading(false);
      return;
    }

    const loadMaintenanceReport = async () => {
      try {
        const report = await getAssetMaintenanceReport(asset.asset_id);
        setMaintenanceReport(report);
      } catch (error) {
        console.error('Error loading maintenance report:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadMaintenanceReport();
  }, [asset.asset_id, initialMaintenanceReport]);

  const getNetworkDeviceIcon = (deviceType: NetworkDeviceAsset['device_type']) => {
    switch (deviceType) {
      case 'switch': return <Network className="h-8 w-8" />;
      case 'router': return <Router className="h-8 w-8" />;
      case 'firewall': return <Shield className="h-8 w-8" />;
      case 'access_point': return <Radio className="h-8 w-8" />;
      case 'load_balancer': return <Scale className="h-8 w-8" />;
      default: return <Network className="h-8 w-8" />;
    }
  };

  const renderBasicInfo = () => (
    <div {...withDataAutomationId({ id: 'basic-info-grid' })} className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div {...withDataAutomationId({ id: 'asset-status-info' })}>
        <Text as="div" size="2" className="font-medium text-gray-700">
          {t('assetDetails.fields.status', { defaultValue: 'Status' })}
        </Text>
        <Badge variant={
          asset.status === 'active' ? 'success' :
          asset.status === 'inactive' ? 'default-muted' :
          'warning'
        }>
          {getAssetStatusLabel(asset.status)}
        </Badge>
      </div>
      <div {...withDataAutomationId({ id: 'asset-serial-info' })}>
        <Text as="div" size="2" className="font-medium text-gray-700">
          {t('assetDetails.fields.serialNumber', { defaultValue: 'Serial Number' })}
        </Text>
        <Text as="div" size="2">
          {asset.serial_number || t('assetDetails.empty.notSpecified', { defaultValue: 'Not specified' })}
        </Text>
      </div>
      <div {...withDataAutomationId({ id: 'asset-location-info' })}>
        <Text as="div" size="2" className="font-medium text-gray-700">
          {t('assetDetails.fields.location', { defaultValue: 'Location' })}
        </Text>
        <Text as="div" size="2">
          {asset.location || t('assetDetails.empty.notSpecified', { defaultValue: 'Not specified' })}
        </Text>
      </div>
      <div {...withDataAutomationId({ id: 'asset-client-info' })}>
        <Text as="div" size="2" className="font-medium text-gray-700">
          {t('assetDetails.fields.client', { defaultValue: 'Client' })}
        </Text>
        <Text as="div" size="2">
          {asset.client?.client_name || t('assetDetails.empty.unassigned', { defaultValue: 'Unassigned' })}
        </Text>
      </div>
      {asset.purchase_date && (
        <div {...withDataAutomationId({ id: 'asset-purchase-date-info' })}>
          <Text as="div" size="2" className="font-medium text-gray-700">
            {t('assetDetails.fields.purchaseDate', { defaultValue: 'Purchase Date' })}
          </Text>
          <Text as="div" size="2">{new Date(asset.purchase_date).toLocaleDateString()}</Text>
        </div>
      )}
      {asset.warranty_end_date && (
        <div {...withDataAutomationId({ id: 'asset-warranty-info' })}>
          <Text as="div" size="2" className="font-medium text-gray-700">
            {t('assetDetails.fields.warrantyEnd', { defaultValue: 'Warranty End' })}
          </Text>
          <Text as="div" size="2" className={new Date(asset.warranty_end_date) < new Date() ? 'text-red-600' : ''}>
            {new Date(asset.warranty_end_date).toLocaleDateString()}
          </Text>
        </div>
      )}
    </div>
  );

  const renderTypeSpecificDetails = () => {
    if (asset.workstation) {
      return (
        <div {...withDataAutomationId({ id: 'workstation-details' })} className="space-y-6">
          <Flex align="center" gap="4" className="mb-6">
            <Monitor className="h-16 w-16 text-primary-500" />
            <div>
              <Text as="div" size="5" weight="medium">
                {t('assetDetails.sections.workstation', { defaultValue: 'Workstation Details' })}
              </Text>
              <Text as="div" size="2" color="gray">{asset.workstation.os_type} {asset.workstation.os_version}</Text>
            </div>
          </Flex>
          <div {...withDataAutomationId({ id: 'workstation-specs-grid' })} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card {...withDataAutomationId({ id: 'workstation-cpu-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Cpu className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.cpu', { defaultValue: 'CPU' })}
                  </Text>
                  <Text as="div" size="2">{asset.workstation.cpu_model} ({asset.workstation.cpu_cores} cores)</Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'workstation-ram-card' })} className="p-4">
              <Flex gap="3" align="center">
                <CircuitBoard className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.ram', { defaultValue: 'RAM' })}
                  </Text>
                  <Text as="div" size="2">{asset.workstation.ram_gb}GB</Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'workstation-storage-card' })} className="p-4">
              <Flex gap="3" align="center">
                <HardDrive className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.storage', { defaultValue: 'Storage' })}
                  </Text>
                  <Text as="div" size="2">{asset.workstation.storage_type} - {asset.workstation.storage_capacity_gb}GB</Text>
                </div>
              </Flex>
            </Card>
            {asset.workstation.gpu_model && (
              <Card {...withDataAutomationId({ id: 'workstation-gpu-card' })} className="p-4">
                <Flex gap="3" align="center">
                  <Monitor className="h-6 w-6 text-primary-400" />
                  <div>
                    <Text as="div" size="2" weight="medium">
                      {t('assetDetails.fields.gpu', { defaultValue: 'GPU' })}
                    </Text>
                    <Text as="div" size="2">{asset.workstation.gpu_model}</Text>
                  </div>
                </Flex>
              </Card>
            )}
            <Card {...withDataAutomationId({ id: 'workstation-login-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Clock className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.lastLogin', { defaultValue: 'Last Login' })}
                  </Text>
                  <Text as="div" size="2">
                    {asset.workstation.last_login
                      ? new Date(asset.workstation.last_login).toLocaleString()
                      : t('assetDetails.empty.never', { defaultValue: 'Never' })}
                  </Text>
                </div>
              </Flex>
            </Card>
          </div>
        </div>
      );
    }

    if (asset.network_device) {
      return (
        <div {...withDataAutomationId({ id: 'network-device-details' })} className="space-y-6">
          <Flex align="center" gap="4" className="mb-6">
            {getNetworkDeviceIcon(asset.network_device.device_type)}
            <div>
              <Text as="div" size="5" weight="medium">
                {t('assetDetails.sections.networkDevice', { defaultValue: 'Network Device Details' })}
              </Text>
              <Text as="div" size="2" color="gray">
                {getDeviceTypeLabel(asset.network_device.device_type)}
              </Text>
            </div>
          </Flex>
          <div {...withDataAutomationId({ id: 'network-device-specs-grid' })} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card {...withDataAutomationId({ id: 'network-device-ip-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Signal className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.managementIp', { defaultValue: 'Management IP' })}
                  </Text>
                  <Text as="div" size="2">{asset.network_device.management_ip}</Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'network-device-ports-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Layers className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.portCount', { defaultValue: 'Port Count' })}
                  </Text>
                  <Text as="div" size="2">{asset.network_device.port_count}</Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'network-device-power-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Power className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.powerDraw', { defaultValue: 'Power Draw' })}
                  </Text>
                  <Text as="div" size="2">{asset.network_device.power_draw_watts}W</Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'network-device-firmware-card' })} className="p-4">
              <Flex gap="3" align="center">
                <RotateCw className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.firmwareVersion', { defaultValue: 'Firmware Version' })}
                  </Text>
                  <Text as="div" size="2">{asset.network_device.firmware_version}</Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'network-device-poe-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Power className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.poeSupport', { defaultValue: 'PoE Support' })}
                  </Text>
                  <Text as="div" size="2">
                    {asset.network_device.supports_poe
                      ? t('common.yes', { defaultValue: 'Yes' })
                      : t('common.no', { defaultValue: 'No' })}
                  </Text>
                </div>
              </Flex>
            </Card>
          </div>
        </div>
      );
    }

    if (asset.server) {
      return (
        <div {...withDataAutomationId({ id: 'server-details' })} className="space-y-6">
          <Flex align="center" gap="4" className="mb-6">
            <Server className="h-16 w-16 text-primary-500" />
            <div>
              <Text as="div" size="5" weight="medium">
                {t('assetDetails.sections.server', { defaultValue: 'Server Details' })}
              </Text>
              <Text as="div" size="2" color="gray">{asset.server.os_type} {asset.server.os_version}</Text>
            </div>
          </Flex>
          <div {...withDataAutomationId({ id: 'server-specs-grid' })} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card {...withDataAutomationId({ id: 'server-cpu-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Cpu className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.cpu', { defaultValue: 'CPU' })}
                  </Text>
                  <Text as="div" size="2">{asset.server.cpu_model} ({asset.server.cpu_cores} cores)</Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'server-ram-card' })} className="p-4">
              <Flex gap="3" align="center">
                <CircuitBoard className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.ram', { defaultValue: 'RAM' })}
                  </Text>
                  <Text as="div" size="2">{asset.server.ram_gb}GB</Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'server-type-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Cloud className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.type', { defaultValue: 'Type' })}
                  </Text>
                  <Text as="div" size="2">
                    {asset.server.is_virtual
                      ? t('assetDetails.values.virtual', { defaultValue: 'Virtual' })
                      : t('assetDetails.values.physical', { defaultValue: 'Physical' })}
                  </Text>
                </div>
              </Flex>
            </Card>
            {asset.server.hypervisor && (
              <Card {...withDataAutomationId({ id: 'server-hypervisor-card' })} className="p-4">
                <Flex gap="3" align="center">
                  <Database className="h-6 w-6 text-primary-400" />
                  <div>
                    <Text as="div" size="2" weight="medium">
                      {t('assetDetails.fields.hypervisor', { defaultValue: 'Hypervisor' })}
                    </Text>
                    <Text as="div" size="2">{asset.server.hypervisor}</Text>
                  </div>
                </Flex>
              </Card>
            )}
            {asset.server.primary_ip && (
              <Card {...withDataAutomationId({ id: 'server-ip-card' })} className="p-4">
                <Flex gap="3" align="center">
                  <Network className="h-6 w-6 text-primary-400" />
                  <div>
                    <Text as="div" size="2" weight="medium">
                      {t('assetDetails.fields.primaryIp', { defaultValue: 'Primary IP' })}
                    </Text>
                    <Text as="div" size="2">{asset.server.primary_ip}</Text>
                  </div>
                </Flex>
              </Card>
            )}
          </div>
        </div>
      );
    }

    if (asset.mobile_device) {
      return (
        <div {...withDataAutomationId({ id: 'mobile-device-details' })} className="space-y-6">
          <Flex align="center" gap="4" className="mb-6">
            <PhoneIcon className="h-16 w-16 text-primary-500" />
            <div>
              <Text as="div" size="5" weight="medium">
                {t('assetDetails.sections.mobileDevice', { defaultValue: 'Mobile Device Details' })}
              </Text>
              <Text as="div" size="2" color="gray">{asset.mobile_device.model}</Text>
            </div>
          </Flex>
          <div {...withDataAutomationId({ id: 'mobile-device-specs-grid' })} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card {...withDataAutomationId({ id: 'mobile-device-os-card' })} className="p-4">
              <Flex gap="3" align="center">
                <AppWindow className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.operatingSystem', { defaultValue: 'Operating System' })}
                  </Text>
                  <Text as="div" size="2">{asset.mobile_device.os_type} {asset.mobile_device.os_version}</Text>
                </div>
              </Flex>
            </Card>
            {asset.mobile_device.imei && (
              <Card {...withDataAutomationId({ id: 'mobile-device-imei-card' })} className="p-4">
                <Flex gap="3" align="center">
                  <Fingerprint className="h-6 w-6 text-primary-400" />
                  <div>
                    <Text as="div" size="2" weight="medium">
                      {t('assetDetails.fields.imei', { defaultValue: 'IMEI' })}
                    </Text>
                    <Text as="div" size="2">{asset.mobile_device.imei}</Text>
                  </div>
                </Flex>
              </Card>
            )}
            {asset.mobile_device.phone_number && (
              <Card {...withDataAutomationId({ id: 'mobile-device-phone-card' })} className="p-4">
                <Flex gap="3" align="center">
                  <PhoneIcon className="h-6 w-6 text-primary-400" />
                  <div>
                    <Text as="div" size="2" weight="medium">
                      {t('assetDetails.fields.phoneNumber', { defaultValue: 'Phone Number' })}
                    </Text>
                    <Text as="div" size="2">{asset.mobile_device.phone_number}</Text>
                  </div>
                </Flex>
              </Card>
            )}
            {asset.mobile_device.carrier && (
              <Card {...withDataAutomationId({ id: 'mobile-device-carrier-card' })} className="p-4">
                <Flex gap="3" align="center">
                  <Signal className="h-6 w-6 text-primary-400" />
                  <div>
                    <Text as="div" size="2" weight="medium">
                      {t('assetDetails.fields.carrier', { defaultValue: 'Carrier' })}
                    </Text>
                    <Text as="div" size="2">{asset.mobile_device.carrier}</Text>
                  </div>
                </Flex>
              </Card>
            )}
            <Card {...withDataAutomationId({ id: 'mobile-device-supervision-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Shield className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.supervisionStatus', { defaultValue: 'Supervision Status' })}
                  </Text>
                  <Text as="div" size="2">
                    {asset.mobile_device.is_supervised
                      ? t('assetDetails.values.supervised', { defaultValue: 'Supervised' })
                      : t('assetDetails.values.unsupervised', { defaultValue: 'Unsupervised' })}
                  </Text>
                </div>
              </Flex>
            </Card>
          </div>
        </div>
      );
    }

    if (asset.printer) {
      return (
        <div {...withDataAutomationId({ id: 'printer-details' })} className="space-y-6">
          <Flex align="center" gap="4" className="mb-6">
            <Printer className="h-16 w-16 text-primary-500" />
            <div>
              <Text as="div" size="5" weight="medium">
                {t('assetDetails.sections.printer', { defaultValue: 'Printer Details' })}
              </Text>
              <Text as="div" size="2" color="gray">{asset.printer.model}</Text>
            </div>
          </Flex>
          <div {...withDataAutomationId({ id: 'printer-specs-grid' })} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {asset.printer.ip_address && (
              <Card {...withDataAutomationId({ id: 'printer-ip-card' })} className="p-4">
                <Flex gap="3" align="center">
                  <Network className="h-6 w-6 text-primary-400" />
                  <div>
                    <Text as="div" size="2" weight="medium">
                      {t('assetDetails.fields.ipAddress', { defaultValue: 'IP Address' })}
                    </Text>
                    <Text as="div" size="2">{asset.printer.ip_address}</Text>
                  </div>
                </Flex>
              </Card>
            )}
            <Card {...withDataAutomationId({ id: 'printer-network-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Wifi className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.networkPrinter', { defaultValue: 'Network Printer' })}
                  </Text>
                  <Text as="div" size="2">
                    {asset.printer.is_network_printer
                      ? t('common.yes', { defaultValue: 'Yes' })
                      : t('common.no', { defaultValue: 'No' })}
                  </Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'printer-color-card' })} className="p-4">
              <Flex gap="3" align="center">
                <Palette className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.colorSupport', { defaultValue: 'Color Support' })}
                  </Text>
                  <Text as="div" size="2">
                    {asset.printer.supports_color
                      ? t('common.yes', { defaultValue: 'Yes' })
                      : t('common.no', { defaultValue: 'No' })}
                  </Text>
                </div>
              </Flex>
            </Card>
            <Card {...withDataAutomationId({ id: 'printer-duplex-card' })} className="p-4">
              <Flex gap="3" align="center">
                <FileStack className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.duplexSupport', { defaultValue: 'Duplex Support' })}
                  </Text>
                  <Text as="div" size="2">
                    {asset.printer.supports_duplex
                      ? t('common.yes', { defaultValue: 'Yes' })
                      : t('common.no', { defaultValue: 'No' })}
                  </Text>
                </div>
              </Flex>
            </Card>
            {asset.printer.monthly_duty_cycle && (
              <Card {...withDataAutomationId({ id: 'printer-duty-cycle-card' })} className="p-4">
                <Flex gap="3" align="center">
                <Gauge className="h-6 w-6 text-primary-400" />
                <div>
                  <Text as="div" size="2" weight="medium">
                    {t('assetDetails.fields.monthlyDutyCycle', { defaultValue: 'Monthly Duty Cycle' })}
                  </Text>
                  <Text as="div" size="2">
                    {asset.printer.monthly_duty_cycle.toLocaleString()} {t('assetDetails.values.pagesUnit', { defaultValue: 'pages' })}
                  </Text>
                  </div>
                </Flex>
              </Card>
            )}
          </div>
        </div>
      );
    }

    return (
      <Text as="p">
        {t('assetDetails.empty.noAdditionalDetails', { defaultValue: 'No additional details available' })}
      </Text>
    );
  };

  const renderMaintenanceSummary = () => {
    if (isLoading || !maintenanceReport) return null;

    return (
      <div {...withDataAutomationId({ id: 'maintenance-summary-grid' })} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card {...withDataAutomationId({ id: 'active-schedules-card' })} className="p-4">
          <Flex justify="between" align="center">
            <div>
              <Text as="div" size="2" color="gray" weight="medium">
                {t('assetDetails.maintenance.activeSchedules', { defaultValue: 'Active Schedules' })}
              </Text>
              <Text as="div" size="6" weight="medium">{maintenanceReport.active_schedules}</Text>
            </div>
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </Flex>
        </Card>

        <Card {...withDataAutomationId({ id: 'overdue-maintenance-card' })} className="p-4">
          <Flex justify="between" align="center">
            <div>
              <Text as="div" size="2" color="gray" weight="medium">
                {t('assetDetails.maintenance.overdue', { defaultValue: 'Overdue' })}
              </Text>
              <Text as="div" size="6" weight="medium" className="text-amber-600">
                {maintenanceReport.completed_maintenances}
              </Text>
            </div>
            <AlertTriangle className="h-8 w-8 text-amber-500" />
          </Flex>
        </Card>

        <Card {...withDataAutomationId({ id: 'upcoming-maintenance-card' })} className="p-4">
          <Flex justify="between" align="center">
            <div>
              <Text as="div" size="2" color="gray" weight="medium">
                {t('assetDetails.maintenance.upcoming', { defaultValue: 'Upcoming' })}
              </Text>
              <Text as="div" size="6" weight="medium" className="text-blue-600">
                {maintenanceReport.upcoming_maintenances}
              </Text>
            </div>
            <Clock className="h-8 w-8 text-blue-500" />
          </Flex>
        </Card>
      </div>
    );
  };

  const renderRelatedAssets = () => {
    if (!asset.relationships || asset.relationships.length === 0) {
      return (
        <Card {...withDataAutomationId({ id: 'no-related-assets' })} className="p-6">
          <Text as="p" color="gray">
            {t('assetDetails.empty.noRelatedAssets', { defaultValue: 'No related assets found' })}
          </Text>
        </Card>
      );
    }

    return (
      <Card {...withDataAutomationId({ id: 'related-assets-card' })} className="p-6">
        <Text as="div" size="4" weight="medium" className="mb-4">
          {t('assetDetails.sections.relatedAssets', { defaultValue: 'Related Assets' })}
        </Text>
        <div {...withDataAutomationId({ id: 'related-assets-list' })} className="space-y-2">
          {asset.relationships.map((rel: AssetRelationship): React.JSX.Element => (
            <div {...withDataAutomationId({ id: `related-asset-${rel.parent_asset_id}-${rel.child_asset_id}` })}
                 key={`${rel.parent_asset_id}-${rel.child_asset_id}`}
                 className="flex justify-between items-center p-2 bg-gray-50 rounded">
              <div>
                <Text as="div" size="2" weight="medium">
                  {getRelationshipLabel(rel.relationship_type)}
                </Text>
                <Text as="div" size="2" color="gray">
                  {rel.parent_asset_id === asset.asset_id
                    ? t('assetDetails.relationships.parentOf', { defaultValue: 'Parent of' })
                    : t('assetDetails.relationships.childOf', { defaultValue: 'Child of' })}{' '}
                  {rel.name}
                </Text>
              </div>
              <Link
                {...withDataAutomationId({ id: `view-related-asset-${rel.parent_asset_id === asset.asset_id ? rel.child_asset_id : rel.parent_asset_id}` })}
                href={`/msp/assets/${rel.parent_asset_id === asset.asset_id ? rel.child_asset_id : rel.parent_asset_id}`}
                className="text-indigo-600 hover:text-indigo-700"
              >
                {t('common.actions.view', { defaultValue: 'View' })}
              </Link>
            </div>
          ))}
        </div>
      </Card>
    );
  };

  const tabContent = [
    {
      id: 'details',
      label: t('assetDetails.tabs.details', { defaultValue: 'Details' }),
      content: (
        <div {...withDataAutomationId({ id: 'details-tab-content' })} className="space-y-6">
          <Card {...withDataAutomationId({ id: 'basic-info-card' })} className="p-6">
            <Text as="div" size="4" weight="medium" className="mb-4">
              {t('assetDetails.sections.basicInformation', { defaultValue: 'Basic Information' })}
            </Text>
            {renderBasicInfo()}
          </Card>

          <Card {...withDataAutomationId({ id: 'type-specific-details-card' })} className="p-6">
            {renderTypeSpecificDetails()}
          </Card>

          {renderMaintenanceSummary()}
        </div>
      )
    },
    {
      id: 'related-assets',
      label: t('assetDetails.tabs.relatedAssets', { defaultValue: 'Related Assets' }),
      content: renderRelatedAssets()
    },
    {
      id: 'documents',
      label: t('assetDetails.tabs.documents', { defaultValue: 'Documents' }),
      content: (
        <Card {...withDataAutomationId({ id: 'documents-card' })} className="p-6">
          {renderDocuments({
            id: 'documents',
            documents: [],
            gridColumns: 3,
            userId: asset.tenant,
            entityId: asset.asset_id,
            entityType: 'asset',
            isLoading: false,
          })}
        </Card>
      )
    }
  ];

  return (
    <div {...withDataAutomationId({ id: 'asset-details-container' })} className="max-w-4xl mx-auto bg-gray-50 p-6">
      <Flex {...withDataAutomationId({ id: 'asset-details-header' })} justify="between" align="center" className="mb-6">
        <div {...withDataAutomationId({ id: 'asset-title' })}>
          <Heading size="6">{asset.name}</Heading>
          <Text as="p" size="2" color="gray">
            {t('assetDetails.assetTag', { defaultValue: 'Asset Tag: {{tag}}', tag: asset.asset_tag })}
          </Text>
        </div>
        <Flex {...withDataAutomationId({ id: 'asset-actions' })} gap="2">
          <CreateTicketFromAssetButton asset={asset} />
          <Link href={`/msp/assets/${asset.asset_id}/edit`}>
            <Button {...withDataAutomationId({ id: 'edit-asset-button' })} variant="outline" className="flex items-center gap-2">
              <Edit className="h-4 w-4" />
              {t('common.actions.edit', { defaultValue: 'Edit' })}
            </Button>
          </Link>
          <DeleteAssetButton
            assetId={asset.asset_id}
            assetName={asset.name}
            redirectTo="/msp/assets"
          />
        </Flex>
      </Flex>

      <div className="relative">
        {isLoading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-white/70 backdrop-blur-sm">
            <Spinner size="md" className="text-primary-500" />
            <Text as="p" size="2" className="mt-2 text-gray-600">
              {t('assetDetails.loading.details', { defaultValue: 'Loading details...' })}
            </Text>
          </div>
        )}
        <CustomTabs
          tabs={tabContent.map((tab) => ({
            ...tab,
            content: isLoading ? renderTabSkeleton(tab.id) : tab.content,
          }))}
        />
      </div>
    </div>
  );
}

function renderTabSkeleton(tabId: string) {
  const rows = Array.from({ length: tabId === 'documents' ? 6 : 4 });
  return (
    <div className="space-y-4">
      {rows.map((_, index) => (
        <div key={`${tabId}-skeleton-${index}`} className="h-16 animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}
