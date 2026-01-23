export interface Tenant {
  tenant: string;
  client_name: string;
  created_at: Date;
  updated_at: Date;
}

export interface TenantCompany {
  client_id: string;
  client_name: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}
