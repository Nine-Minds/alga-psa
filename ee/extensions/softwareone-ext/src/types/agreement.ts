// Simple Agreement interface for MVP
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
  createdAt: string;
  updatedAt: string;
}

// Local configuration that can be edited
export interface LocalAgreementConfig {
  markup?: number;
  notes?: string;
  customBilling?: boolean;
}

// Combined type for display
export interface AgreementWithConfig extends Agreement {
  localConfig?: LocalAgreementConfig;
}