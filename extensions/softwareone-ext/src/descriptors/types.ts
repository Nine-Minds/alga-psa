/**
 * SoftwareOne Extension Descriptor Types
 * 
 * Extension-specific types that extend the base descriptor system
 */

// Re-export the base descriptor types
export interface UIDescriptor {
  type: string;
  props?: Record<string, any>;
  children?: (UIDescriptor | string | number)[];
  handlers?: Record<string, string | HandlerDescriptor>;
  style?: StyleDescriptor;
  condition?: ConditionDescriptor;
  permissions?: string[];
  id?: string;
}

export interface HandlerDescriptor {
  handler: string;
  params?: Record<string, any>;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

export interface StyleDescriptor {
  className?: string;
  style?: React.CSSProperties;
  sx?: Record<string, any>;
}

export interface ConditionDescriptor {
  path: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains' | 'exists';
  value?: any;
}

export interface TableDescriptor extends UIDescriptor {
  type: 'table';
  data: {
    key: string;
    source: string;
    endpoint?: string;
  };
  columns: any[];
  pagination?: any;
  filtering?: any;
  sorting?: any;
}

export interface FormDescriptor extends UIDescriptor {
  type: 'form';
  onSubmit: string;
  fields: any[];
  initialValues?: Record<string, any>;
}

/**
 * Agreement data structure
 */
export interface Agreement {
  id: string;
  name: string;
  product: string;
  vendor: string;
  consumer: string;
  consumerId: string;
  status: 'active' | 'inactive' | 'pending';
  currency: string;
  spxy: number;
  marginRpxy: number;
  operationsVisibility: 'visible' | 'hidden';
  billingConfigId?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Statement data structure
 */
export interface Statement {
  id: string;
  statementNumber: string;
  period: string;
  consumer: string;
  consumerId: string;
  totalAmount: number;
  currency: string;
  status: 'pending' | 'processed' | 'imported';
  dueDate: string;
  importedAt?: string;
  createdAt: string;
}

/**
 * Statement charge/line item
 */
export interface StatementCharge {
  id: string;
  statementId: string;
  description: string;
  product: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  agreementId?: string;
}

/**
 * SoftwareOne API configuration
 */
export interface SoftwareOneConfig {
  apiEndpoint: string;
  apiToken: string;
  syncInterval: number;
  autoSync: boolean;
  lastSyncAt?: string;
}

/**
 * Service catalog mapping
 */
export interface ServiceMapping {
  productName: string;
  algaServiceId: string;
  algaServiceName: string;
  markup: number;
}

/**
 * Navigation item descriptor
 */
export interface NavItemDescriptor extends UIDescriptor {
  type: 'nav-item';
  props: {
    label: string;
    icon?: string;
    path: string;
    badge?: {
      count: number;
      color: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
    };
  };
}

/**
 * Agreements list table descriptor
 */
export interface AgreementsTableDescriptor extends TableDescriptor {
  type: 'table';
  data: {
    key: string;
    source: 'api';
    endpoint: '/api/extensions/softwareone/agreements';
  };
}

/**
 * Settings form descriptor
 */
export interface SettingsFormDescriptor extends FormDescriptor {
  type: 'form';
  tabs?: {
    key: string;
    label: string;
    icon?: string;
    content: UIDescriptor;
  }[];
}

/**
 * Agreement detail descriptor
 */
export interface AgreementDetailDescriptor extends UIDescriptor {
  type: 'page';
  data: {
    agreement: Agreement;
    statements: Statement[];
    charges: StatementCharge[];
  };
  tabs: {
    key: string;
    label: string;
    content: UIDescriptor;
  }[];
}

/**
 * Import wizard descriptor
 */
export interface ImportWizardDescriptor extends UIDescriptor {
  type: 'wizard';
  steps: {
    key: string;
    label: string;
    description?: string;
    content: UIDescriptor;
    validation?: string;
  }[];
}

/**
 * Handler parameter types
 */
export interface ActivateAgreementParams {
  agreementId: string;
  effectiveDate: string;
  serviceMappings: ServiceMapping[];
}

export interface ImportStatementParams {
  statementId: string;
  lineItems: {
    chargeId: string;
    serviceId: string;
    markup: number;
  }[];
  createInvoice: boolean;
  invoiceDate?: string;
}

export interface SyncDataParams {
  syncAgreements?: boolean;
  syncStatements?: boolean;
  fromDate?: string;
  toDate?: string;
}

/**
 * Component slot types
 */
export interface ExtensionSlots {
  mainNavigation: NavItemDescriptor;
  settingsNavigation: NavItemDescriptor;
  dashboardWidget?: UIDescriptor;
}

/**
 * Extension context data
 */
export interface ExtensionData {
  config: SoftwareOneConfig;
  agreements: Agreement[];
  statements: Statement[];
  serviceMappings: ServiceMapping[];
  syncStatus: {
    lastSync: string;
    nextSync: string;
    inProgress: boolean;
    errors: string[];
  };
}