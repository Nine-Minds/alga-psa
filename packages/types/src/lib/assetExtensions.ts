/** Built-in asset types backed by dedicated extension records. Custom types store their values in attributes. */
export const EXTENSION_TABLE_BY_ASSET_TYPE: Readonly<Record<string, string>> = {
  workstation: 'workstation_assets',
  network_device: 'network_device_assets',
  server: 'server_assets',
  mobile_device: 'mobile_device_assets',
  printer: 'printer_assets',
};
