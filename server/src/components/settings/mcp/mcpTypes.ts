/** Shared shapes for the MCP Server settings screen and its dev demo data. */

export interface TrustedIdp {
  issuer: string;
  jwks_uri: string;
  audience: string | null;
  subject_claim: string;
  kind?: 'google' | 'microsoft' | 'custom';
  entra_tenant_id?: string | null;
  active: boolean;
}

export interface Agent {
  agent_id: string;
  name: string;
  description: string | null;
  idp_issuer: string | null;
  idp_subject: string | null;
  active: boolean;
}

export interface Role {
  role_id: string;
  role_name: string;
}

export interface AuditRow {
  agent_id: string;
  tool: string;
  ok: boolean;
  decision: string | null;
  status_code: number | null;
  created_at: string;
}
