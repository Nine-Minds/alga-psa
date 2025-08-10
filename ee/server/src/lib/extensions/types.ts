/**
 * Types for the extension system
 */
 
/**
 * Extension manifest format
 */
export interface ExtensionManifest {
  id?: string; // Optional ID field
  name: string;
  description?: string;
  version: string;
  author?: string | { name: string; email?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  main: string;
  components?: any[]; // Components can have various structures based on type
  permissions?: any; // Can be string[] or object with nested permissions
  requiredExtensions?: string[];
  settings?: ExtensionSettingDefinition[];
  assets?: string[];
  tenantMode?: 'all' | 'specific';
  autoEnable?: boolean;
  minAppVersion?: string;
  api?: {
    endpoints?: ExtensionApiEndpoint[];
  };
}

/**
 * Supported extension component types
 */
export enum ExtensionComponentType {
  TAB = 'tab-extension',
  NAVIGATION = 'navigation',
  DASHBOARD_WIDGET = 'dashboard-widget',
  CUSTOM_PAGE = 'custom-page',
  PAGE = 'page',
}

/**
 * Base component definition in manifest
 */
export interface BaseComponentDefinition {
  type: ExtensionComponentType;
  slot: string;
  component: string;
  props?: Record<string, any>;
}

/**
 * Tab extension component definition
 */
export interface TabExtensionDefinition extends BaseComponentDefinition {
  type: ExtensionComponentType.TAB;
  props: TabExtensionProps;
}

/**
 * Properties for tab extensions
 */
export interface TabExtensionProps {
  id: string;             // Unique identifier
  parentPage: string;     // Parent page to attach to (e.g., "billing", "tickets")
  label: string;          // Display text for the tab
  icon?: string;          // Optional icon name
  priority?: number;      // Order in the tabs (higher = earlier)
  permissions?: string[]; // Required permissions
}

/**
 * Navigation item component definition
 */
export interface NavigationItemDefinition extends BaseComponentDefinition {
  type: ExtensionComponentType.NAVIGATION;
  props: NavigationItemProps;
}

/**
 * Properties for navigation items
 */
export interface NavigationItemProps {
  id: string;             // Unique identifier
  label: string;          // Display text
  icon?: string;          // Icon name from IconRegistry
  path: string;           // Route path
  priority?: number;      // Order in the menu (higher = earlier)
  permissions?: string[]; // Required permissions
}

/**
 * Dashboard widget component definition
 */
export interface DashboardWidgetDefinition extends BaseComponentDefinition {
  type: ExtensionComponentType.DASHBOARD_WIDGET;
  props: DashboardWidgetProps;
}

/**
 * Properties for dashboard widgets
 */
export interface DashboardWidgetProps {
  id: string;             // Unique identifier
  title: string;          // Widget title
  size: 'small' | 'medium' | 'large'; // Widget size
  refreshInterval?: number; // Refresh data interval in seconds
  permissions?: string[]; // Required permissions
}

/**
 * Custom page component definition
 */
export interface CustomPageDefinition extends BaseComponentDefinition {
  type: ExtensionComponentType.CUSTOM_PAGE;
  props: CustomPageProps;
}

/**
 * Properties for custom pages
 */
export interface CustomPageProps {
  id: string;             // Unique identifier
  path: string;           // Route path (relative to extension namespace)
  title: string;          // Page title
  icon?: string;          // Icon for navigation
  permissions?: string[]; // Required permissions
}

/**
 * Union type for all component definitions
 */
export type ExtensionComponentDefinition = 
  | TabExtensionDefinition
  | NavigationItemDefinition
  | DashboardWidgetDefinition
  | CustomPageDefinition;

/**
 * Extension setting definition in manifest
 */
export interface ExtensionSettingDefinition {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  label: string;
  description?: string;
  default?: any;
  options?: Array<{
    label: string;
    value: string | number | boolean;
  }>;
  required?: boolean;
  encrypted?: boolean;
  min?: number;
  max?: number;
}

/**
 * Database extension model
 */
export interface Extension {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  version: string;
  manifest: ExtensionManifest;
  main_entry_point: string | null;
  is_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Extension permission model
 */
export interface ExtensionPermission {
  id: string;
  extension_id: string;
  resource: string;
  action: string;
  created_at: Date;
}

/**
 * Extension file model
 */
export interface ExtensionFile {
  id: string;
  extension_id: string;
  path: string;
  content_hash: string | null;
  size: number | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Extension storage model
 */
export interface ExtensionStorage {
  id: string;
  extension_id: string;
  tenant_id: string;
  key: string;
  value: any;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Extension settings model
 */
export interface ExtensionSettings {
  id: string;
  extension_id: string;
  tenant_id: string;
  settings: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Extension initialization options
 */
export interface ExtensionInitOptions {
  tenant_id: string;
  userId?: string;
}

/**
 * Extension context provided to extension components
 */
export interface ExtensionContext {
  extensionId: string;
  tenantId: string;
  getStorage: () => ExtensionStorageService;
  getSettings: () => Promise<Record<string, any>>;
  updateSettings: (settings: Record<string, any>) => Promise<void>;
  hasPermission: (permission: string) => Promise<boolean>;
}

/**
 * Storage service for extensions
 */
export interface ExtensionStorageService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: StorageOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  getBatch<T>(keys: string[]): Promise<Map<string, T>>;
  setBatch<T>(entries: Record<string, T>, options?: StorageOptions): Promise<void>;
  getNamespace(namespace: string): ExtensionStorageService;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Options for storage operations
 */
export interface StorageOptions {
  expiresIn?: number; // TTL in seconds
}

/**
 * Extension API endpoint definition
 */
export interface ExtensionApiEndpoint {
  id: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  handler: string;
  permissions?: string[];
}

/**
 * Extension registry service interface
 */
export interface ExtensionRegistry {
  registerExtension(manifest: ExtensionManifest, options: ExtensionInitOptions): Promise<Extension>;
  getExtension(id: string, options: ExtensionInitOptions): Promise<Extension | null>;
  getExtensionByName(name: string, options: ExtensionInitOptions): Promise<Extension | null>;
  listExtensions(options: ExtensionInitOptions): Promise<Extension[]>;
  enableExtension(id: string, options: ExtensionInitOptions): Promise<boolean>;
  disableExtension(id: string, options: ExtensionInitOptions): Promise<boolean>;
  uninstallExtension(id: string, options: ExtensionInitOptions): Promise<boolean>;
  getExtensionContext(id: string, options: ExtensionInitOptions): Promise<ExtensionContext>;
  getComponentsByType(type: ExtensionComponentType, options: ExtensionInitOptions): Promise<ExtensionComponentDefinition[]>;
  getComponentsBySlot(slot: string, options: ExtensionInitOptions): Promise<ExtensionComponentDefinition[]>;
}