/**
 * Huntress public API types.
 *
 * Shapes follow the Huntress OpenAPI spec (api.huntress.io). List endpoints
 * wrap results: { incident_reports: [...], pagination: { next_page_token } }.
 */

export type HuntressSeverity = 'low' | 'high' | 'critical';

export type HuntressIncidentStatus =
  | 'sent'
  | 'closed'
  | 'dismissed'
  | 'auto_remediating'
  | 'deleting'
  | 'partner_dismissed';

export interface HuntressRemediationParameter {
  name: string;
  description: string;
}

export interface HuntressRemediation {
  id: number;
  type: string;
  action?: string;
  status?: string;
  parameters?: HuntressRemediationParameter[];
  approved_at?: string | null;
  completed_at?: string | null;
}

export interface HuntressIncidentReport {
  id: number;
  account_id: number;
  agent_id: number | null;
  organization_id: number | null;
  subject: string | null;
  summary: string | null;
  body: string | null;
  severity: HuntressSeverity;
  status: HuntressIncidentStatus;
  platform: string | null;
  indicator_types: string[];
  indicator_counts: Record<string, number>;
  remediations?: {
    total_count: number;
    has_more: boolean;
    items: HuntressRemediation[];
  };
  sent_at: string | null;
  closed_at: string | null;
  status_updated_at: string | null;
  updated_at: string;
}

export interface HuntressOrganization {
  id: number;
  name: string;
  key?: string;
}

export interface HuntressAgent {
  id: number;
  hostname: string | null;
  platform?: string | null;
  os?: string | null;
  ipv4_address?: string | null;
  external_ip?: string | null;
  serial_number?: string | null;
  last_callback_at?: string | null;
}

export interface HuntressAccount {
  id: number;
  name: string;
  subdomain: string;
}

export interface HuntressPagination {
  next_page_token?: string | null;
  next_page_url?: string | null;
}

export interface HuntressIncidentReportsPage {
  incident_reports: HuntressIncidentReport[];
  pagination?: HuntressPagination;
}

export interface HuntressOrganizationsPage {
  organizations: HuntressOrganization[];
  pagination?: HuntressPagination;
}
