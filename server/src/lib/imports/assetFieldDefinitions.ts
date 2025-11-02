import type { FieldDefinition } from '@/types/imports.types';
import {
  createEnumValidator,
  createMacAddressParser,
  createMacAddressValidator,
  createIpAddressValidator,
  createMaxLengthValidator,
  createDateParser,
  createToUpperCaseParser,
} from './validators';

export const ASSET_TYPE_VALUES = [
  'workstation',
  'network_device',
  'server',
  'mobile_device',
  'printer',
  'unknown',
] as const;

export const assetFieldDefinitions: FieldDefinition[] = [
  {
    field: 'name',
    label: 'Asset Name',
    required: true,
    example: 'NYC-WS-001',
    validators: [createMaxLengthValidator('name', 'Asset Name', 255)],
  },
  {
    field: 'asset_type',
    label: 'Asset Type',
    required: true,
    example: 'workstation',
    validators: [createEnumValidator('asset_type', 'Asset Type', ASSET_TYPE_VALUES)],
    parser: createToUpperCaseParser(),
  },
  {
    field: 'serial_number',
    label: 'Serial Number',
    example: 'ABC123456',
    validators: [createMaxLengthValidator('serial_number', 'Serial Number', 255)],
  },
  {
    field: 'asset_tag',
    label: 'Asset Tag',
    example: 'TAG-001',
    validators: [createMaxLengthValidator('asset_tag', 'Asset Tag', 255)],
  },
  {
    field: 'mac_address',
    label: 'MAC Address',
    example: '00:11:22:33:44:55',
    parser: createMacAddressParser('MAC Address'),
    validators: [createMacAddressValidator('mac_address', 'MAC Address')],
  },
  {
    field: 'ip_address',
    label: 'IP Address',
    example: '192.168.1.100',
    validators: [createIpAddressValidator('ip_address', 'IP Address')],
  },
  {
    field: 'purchase_date',
    label: 'Purchase Date',
    example: '2025-01-15',
    parser: createDateParser('Purchase Date'),
  },
  {
    field: 'warranty_end_date',
    label: 'Warranty End Date',
    example: '2027-01-15',
    parser: createDateParser('Warranty End Date'),
  },
];

export const getAssetFieldDefinitions = (): FieldDefinition[] => [...assetFieldDefinitions];
