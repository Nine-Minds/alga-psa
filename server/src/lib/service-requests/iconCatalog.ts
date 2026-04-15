export interface ServiceRequestIconOption {
  value: string;
  label: string;
}

export const SERVICE_REQUEST_ICON_OPTIONS: ServiceRequestIconOption[] = [
  { value: 'file-text', label: 'General Request' },
  { value: 'user-plus', label: 'New User' },
  { value: 'user-minus', label: 'Offboarding' },
  { value: 'shield-check', label: 'Security' },
  { value: 'key-round', label: 'Access' },
  { value: 'laptop', label: 'Laptop' },
  { value: 'monitor', label: 'Workstation' },
  { value: 'printer', label: 'Printer' },
  { value: 'hard-drive', label: 'Storage' },
  { value: 'server', label: 'Server' },
  { value: 'network', label: 'Network' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'mail', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'folder-open', label: 'Shared Files' },
  { value: 'badge-help', label: 'Help' },
];
