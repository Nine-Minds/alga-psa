/** Explicit operational inventory projection. Provider bindings and procurement links are not portable. */
export const CO_MANAGED_PORTABLE_ASSET_COLUMNS = {
  assets: ['asset_id', 'asset_tag', 'serial_number', 'name', 'status', 'location', 'purchase_date', 'warranty_end_date', 'attributes', 'created_at', 'updated_at', 'asset_type', 'client_id', 'agent_status', 'last_seen_at', 'last_rmm_sync_at', 'notes_document_id', 'location_id'],
  asset_type_registry: ['type_id', 'slug', 'name', 'icon', 'fields_schema', 'is_builtin', 'display_order', 'created_at', 'updated_at'],
  workstation_assets: ['asset_id', 'os_type', 'os_version', 'cpu_model', 'cpu_cores', 'ram_gb', 'storage_type', 'storage_capacity_gb', 'gpu_model', 'last_login', 'installed_software', 'agent_version', 'antivirus_status', 'antivirus_product', 'last_reboot_at', 'pending_patches', 'failed_patches', 'last_patch_scan_at', 'system_info', 'current_user', 'uptime_seconds', 'lan_ip', 'wan_ip', 'cpu_utilization_percent', 'memory_usage_percent', 'memory_used_gb', 'disk_usage', 'pending_os_patches', 'pending_software_patches'],
  server_assets: ['asset_id', 'os_type', 'os_version', 'cpu_model', 'cpu_cores', 'ram_gb', 'storage_config', 'raid_config', 'is_virtual', 'hypervisor', 'network_interfaces', 'primary_ip', 'installed_services', 'agent_version', 'antivirus_status', 'antivirus_product', 'last_reboot_at', 'pending_patches', 'failed_patches', 'last_patch_scan_at', 'system_info', 'disk_usage', 'cpu_usage_percent', 'memory_usage_percent', 'current_user', 'uptime_seconds', 'lan_ip', 'wan_ip', 'memory_used_gb', 'pending_os_patches', 'pending_software_patches', 'installed_software'],
  network_device_assets: ['asset_id', 'device_type', 'management_ip', 'port_count', 'firmware_version', 'supports_poe', 'power_draw_watts', 'vlan_config', 'port_config'],
  printer_assets: ['asset_id', 'model', 'ip_address', 'is_network_printer', 'supports_color', 'supports_duplex', 'max_paper_size', 'supported_paper_types', 'monthly_duty_cycle', 'supply_levels'],
  mobile_device_assets: ['asset_id', 'os_type', 'os_version', 'model', 'imei', 'phone_number', 'carrier', 'last_check_in', 'is_supervised', 'installed_apps'],
  software_catalog: ['software_id', 'name', 'publisher', 'normalized_name', 'category', 'software_type', 'is_managed', 'is_security_relevant', 'created_at', 'updated_at'],
  asset_software: ['asset_id', 'software_id', 'version', 'install_date', 'install_path', 'size_bytes', 'first_seen_at', 'last_seen_at', 'is_current', 'uninstalled_at'],
  asset_history: ['history_id', 'asset_id', 'changed_by', 'change_type', 'changes', 'changed_at'],
  asset_facts: ['asset_fact_id', 'asset_id', 'source_type', 'provider', 'namespace', 'fact_key', 'label', 'value_text', 'value_number', 'value_bool', 'value_json', 'source', 'source_updated_at', 'last_synced_at', 'is_available', 'created_at', 'updated_at'],
  asset_relationships: ['parent_asset_id', 'child_asset_id', 'relationship_type', 'created_at', 'updated_at'],
  asset_service_history: ['history_id', 'asset_id', 'ticket_id', 'service_type', 'description', 'service_details', 'service_date', 'next_service_date', 'performed_by', 'created_at'],
  asset_maintenance_schedules: ['schedule_id', 'asset_id', 'schedule_name', 'description', 'maintenance_type', 'frequency', 'frequency_interval', 'schedule_config', 'last_maintenance', 'next_maintenance', 'is_active', 'created_by', 'created_at', 'updated_at', 'archived_at'],
  asset_maintenance_history: ['history_id', 'schedule_id', 'asset_id', 'maintenance_type', 'description', 'maintenance_data', 'performed_at', 'performed_by', 'created_at'],
  asset_maintenance_occurrences: ['occurrence_id', 'schedule_id', 'asset_id', 'due_date', 'status', 'ticket_id', 'history_id', 'skip_reason', 'closed_at', 'closed_by', 'created_at', 'updated_at'],
  asset_document_associations: ['association_id', 'asset_id', 'document_id', 'notes', 'created_at', 'created_by'],
  asset_ticket_associations: ['association_id', 'asset_id', 'ticket_id', 'association_type', 'notes', 'created_at', 'created_by'],
  asset_associations: ['asset_id', 'entity_id', 'entity_type', 'relationship_type', 'created_at', 'created_by', 'notes'],
} as const;
export type CoManagedPortableAssetTable = keyof typeof CO_MANAGED_PORTABLE_ASSET_COLUMNS;
export type CoManagedPortableAssetRecords = Record<CoManagedPortableAssetTable, Record<string, unknown>[]>;
