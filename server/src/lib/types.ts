export interface Tenant {
  tenant: string;
  company_name: string;
  created_at: Date;
  updated_at: Date;
}

export interface TenantCompany {
  company_id: string;
  company_name: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}