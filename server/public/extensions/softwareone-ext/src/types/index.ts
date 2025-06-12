export interface SoftwareOneConfig {
  apiEndpoint: string;
  apiToken: string;
  syncInterval: number;
  enableAutoSync: boolean;
}

export interface Agreement {
  id: string;
  name: string;
  product: string;
  vendor: string;
  billingConfigId: string;
  currency: string;
  spxYear: number;
  marginRpxy: number;
  consumer: string;
  operations: 'visible' | 'hidden' | 'restricted';
  status: 'active' | 'inactive' | 'pending' | 'expired';
  createdAt: string;
  updatedAt: string;
  localConfig?: {
    markup?: number;
    notes?: string;
    tags?: string[];
  };
}

export interface Subscription {
  id: string;
  agreementId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'cancelled' | 'expired';
}

export interface Order {
  id: string;
  agreementId: string;
  orderNumber: string;
  orderDate: string;
  totalAmount: number;
  currency: string;
  status: 'pending' | 'completed' | 'cancelled';
  items: OrderItem[];
}

export interface OrderItem {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Statement {
  id: string;
  statementNumber: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  currency: string;
  status: 'draft' | 'final' | 'billed';
  charges: StatementCharge[];
}

export interface StatementCharge {
  id: string;
  agreementId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  chargeDate: string;
}

export interface Consumer {
  id: string;
  name: string;
  email: string;
  companyId?: string; // Mapped to Alga company
}

export interface SyncResult {
  success: boolean;
  message: string;
  counts?: {
    agreements: number;
    statements: number;
    subscriptions: number;
    orders: number;
  };
  errors?: string[];
}

export interface ExtensionContext {
  tenant: {
    id: string;
    name: string;
  };
  user: {
    id: string;
    email: string;
    permissions: string[];
  };
  storage: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any, ttl?: number) => Promise<void>;
    delete: (key: string) => Promise<void>;
    getNamespace: (namespace: string) => any;
  };
  api: {
    call: (method: string, path: string, data?: any) => Promise<any>;
  };
  logger: {
    info: (message: string, data?: any) => void;
    warn: (message: string, data?: any) => void;
    error: (message: string, error?: any) => void;
  };
}