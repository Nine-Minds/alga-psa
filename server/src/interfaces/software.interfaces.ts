/**
 * Software Inventory Interfaces
 *
 * Types for the normalized software inventory system that replaces
 * the previous JSONB installed_software columns.
 *
 * @see ee/docs/plans/asset-detail-view-enhancement.md §1.5.1
 */

// Software type classification
export type SoftwareType = 'application' | 'driver' | 'update' | 'system';

// Software category for filtering/grouping
export type SoftwareCategory =
  | 'Browser'
  | 'Productivity'
  | 'Development'
  | 'Security'
  | 'Communication'
  | 'Creative'
  | 'Runtime'
  | 'Driver'
  | null;

/**
 * Canonical software entry (deduplicated per tenant)
 * Represents a unique piece of software in the software_catalog table.
 */
export interface SoftwareCatalogEntry {
  software_id: string;
  tenant: string;
  name: string;
  publisher: string | null;
  normalized_name: string;
  category: SoftwareCategory;
  software_type: SoftwareType;
  is_managed: boolean;          // Tracked for patching/licensing
  is_security_relevant: boolean; // Antivirus, firewall, etc.
  created_at: string;
  updated_at: string;
}

/**
 * Software installed on a specific asset (junction table)
 * Links assets to software catalog entries with installation details.
 */
export interface AssetSoftwareInstall {
  tenant: string;
  asset_id: string;
  software_id: string;
  version: string | null;
  install_date: string | null;
  install_path: string | null;
  size_bytes: number | null;
  first_seen_at: string;
  last_seen_at: string;
  is_current: boolean;
  uninstalled_at: string | null;

  // Joined from software_catalog (when needed)
  software?: SoftwareCatalogEntry;
}

/**
 * Display item for asset detail software tab
 * Flattened view combining catalog and install info.
 */
export interface AssetSoftwareDisplayItem {
  software_id: string;
  name: string;
  publisher: string | null;
  category: SoftwareCategory;
  software_type: SoftwareType;
  version: string | null;
  install_date: string | null;
  size_bytes: number | null;
  first_seen_at: string;
  is_current: boolean;
  is_managed: boolean;
  is_security_relevant: boolean;
}

/**
 * Fleet-wide software search result
 * Used when searching for software across all assets.
 */
export interface SoftwareSearchResult {
  software_id: string;
  name: string;
  publisher: string | null;
  category: SoftwareCategory;
  software_type: SoftwareType;
  is_managed: boolean;
  is_security_relevant: boolean;
  install_count: number; // How many assets have this installed
  assets: SoftwareAssetInfo[];
}

/**
 * Asset info within a software search result
 */
export interface SoftwareAssetInfo {
  asset_id: string;
  asset_name: string;
  asset_type: string;
  client_id: string;
  client_name: string;
  version: string | null;
  install_date: string | null;
}

/**
 * Parameters for querying asset software
 */
export interface AssetSoftwareQueryParams {
  asset_id: string;
  include_uninstalled?: boolean;
  category?: SoftwareCategory;
  software_type?: SoftwareType;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Parameters for fleet-wide software search
 */
export interface SoftwareSearchParams {
  search?: string;
  category?: SoftwareCategory;
  software_type?: SoftwareType;
  is_managed?: boolean;
  is_security_relevant?: boolean;
  client_id?: string;
  page?: number;
  limit?: number;
}

/**
 * Response for paginated software list
 */
export interface AssetSoftwareListResponse {
  software: AssetSoftwareDisplayItem[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Response for fleet-wide software search
 */
export interface SoftwareSearchResponse {
  results: SoftwareSearchResult[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Request to update software catalog entry
 */
export interface UpdateSoftwareCatalogRequest {
  category?: SoftwareCategory;
  is_managed?: boolean;
  is_security_relevant?: boolean;
}

/**
 * Software change event (for audit/reporting)
 */
export interface SoftwareChangeEvent {
  tenant: string;
  asset_id: string;
  asset_name: string;
  software_id: string;
  software_name: string;
  change_type: 'installed' | 'uninstalled' | 'version_changed';
  old_version?: string | null;
  new_version?: string | null;
  detected_at: string;
}

/**
 * Software summary statistics for an asset
 */
export interface AssetSoftwareSummary {
  total_installed: number;
  by_category: Record<string, number>;
  by_type: Record<SoftwareType, number>;
  security_software_count: number;
  managed_software_count: number;
  recently_installed_count: number; // Last 30 days
}

/**
 * Software summary statistics for fleet
 */
export interface FleetSoftwareSummary {
  total_unique_software: number;
  total_installations: number;
  top_installed: Array<{
    software_id: string;
    name: string;
    publisher: string | null;
    install_count: number;
  }>;
  by_category: Record<string, number>;
  unmanaged_security_software: number; // Security software not marked as managed
}
