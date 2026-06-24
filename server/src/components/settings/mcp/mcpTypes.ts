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

/**
 * A platform-managed OAuth app (the hosted shared Microsoft/Google apps that
 * already back SSO). When present, the tenant can provision agents against it
 * with no IdP registration — so the UI surfaces it as "ready to use".
 */
export interface PlatformProvider {
  provider: 'microsoft' | 'google';
  label: string;
  /** Fixed issuer for Google; null for Microsoft (the concrete tenant issuer is only known after connect). */
  issuer: string | null;
  available: boolean;
}

/** Identity auto-discovered by the "Connect with Microsoft/Google" flow. */
export interface ConnectIdentity {
  provider: 'microsoft' | 'google';
  issuer: string;
  /** The id_token `sub` — stored as the agent's idp_subject. */
  subject: string;
  /** Human-readable (email / name) used to default the agent name. */
  label: string;
}
