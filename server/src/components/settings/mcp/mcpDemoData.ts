/**
 * Dev-only synthetic data for previewing the MCP Server settings screen in its
 * populated states. The real /api/v1/mcp/* endpoints need an EE build + a
 * trusted-IdP/agent setup, so this lets us exercise the UI (populated tables,
 * status badges, the issuer picker, the activity log) without that backend.
 *
 * Gated two ways: never returns a mode in production, and only when the URL
 * carries `?mcpDemo=...`. It seeds local component state only — it never writes
 * anything and never changes the real API path.
 *
 *   ?mcpDemo=full           providers + agents + roles + a suggestion (default)
 *   ?mcpDemo=providers      providers + roles, no agents
 *   ?mcpDemo=empty          force the empty state (ignore the API)
 */
import type { TrustedIdp, Agent, Role, AuditRow } from './mcpTypes';

export type McpDemoMode = 'full' | 'providers' | 'empty';

export function getMcpDemoMode(): McpDemoMode | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('mcpDemo');
  if (raw === null) return null;
  if (raw === 'providers') return 'providers';
  if (raw === 'empty') return 'empty';
  return 'full';
}

const MS_TENANT = 'a1b2c3d4-5566-7788-99aa-bbccddeeff00';
const MS_ISSUER = `https://login.microsoftonline.com/${MS_TENANT}/v2.0`;
const GOOGLE_ISSUER = 'https://accounts.google.com';
const CUSTOM_ISSUER = 'https://login.acme.example.com/tenant';

export const DEMO_IDPS: TrustedIdp[] = [
  {
    issuer: MS_ISSUER,
    jwks_uri: `https://login.microsoftonline.com/${MS_TENANT}/discovery/v2.0/keys`,
    audience: 'api://alga-mcp',
    subject_claim: 'azp',
    kind: 'microsoft',
    entra_tenant_id: MS_TENANT,
    active: true,
  },
  {
    issuer: GOOGLE_ISSUER,
    jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    audience: null,
    subject_claim: 'sub',
    kind: 'google',
    active: true,
  },
  {
    issuer: CUSTOM_ISSUER,
    jwks_uri: 'https://login.acme.example.com/.well-known/jwks.json',
    audience: 'https://alga.acme.example.com/api/mcp',
    subject_claim: 'sub',
    kind: 'custom',
    active: true,
  },
];

export const DEMO_AGENTS: Agent[] = [
  {
    agent_id: 'agent-support',
    name: 'Support triage bot',
    description: null,
    idp_issuer: MS_ISSUER,
    idp_subject: '11111111-2222-3333-4444-555555555555',
    active: true,
  },
  {
    agent_id: 'agent-billing',
    name: 'Billing reconciler',
    description: null,
    idp_issuer: GOOGLE_ISSUER,
    idp_subject: 'billing-bot@acme.iam.gserviceaccount.com',
    active: true,
  },
  {
    agent_id: 'agent-legacy',
    name: 'Legacy importer',
    description: null,
    idp_issuer: CUSTOM_ISSUER,
    idp_subject: 'legacy-import-client',
    active: false,
  },
];

export const DEMO_ROLES: Role[] = [
  { role_id: 'role-tech', role_name: 'Technician' },
  { role_id: 'role-billing', role_name: 'Billing' },
  { role_id: 'role-dispatch', role_name: 'Dispatcher' },
  { role_id: 'role-readonly', role_name: 'Read only' },
];

export const DEMO_SUGGESTION = {
  microsoft: { entraTenantId: MS_TENANT, displayName: 'Acme Corp' },
};

export function demoAudit(agentId: string): AuditRow[] {
  const base = Date.parse('2026-06-24T14:00:00Z');
  const mins = (n: number) => new Date(base - n * 60_000).toISOString();
  return [
    { agent_id: agentId, tool: 'tickets.list', ok: true, decision: 'allow', status_code: 200, created_at: mins(2) },
    { agent_id: agentId, tool: 'tickets.update', ok: true, decision: 'allow', status_code: 200, created_at: mins(11) },
    { agent_id: agentId, tool: 'invoices.create', ok: false, decision: 'deny', status_code: 403, created_at: mins(37) },
    { agent_id: agentId, tool: 'contacts.search', ok: true, decision: 'allow', status_code: 200, created_at: mins(64) },
  ];
}

export function demoState(mode: McpDemoMode): {
  idps: TrustedIdp[];
  agents: Agent[];
  roles: Role[];
  suggestion: typeof DEMO_SUGGESTION | Record<string, never>;
} {
  if (mode === 'empty') return { idps: [], agents: [], roles: DEMO_ROLES, suggestion: DEMO_SUGGESTION };
  if (mode === 'providers') return { idps: DEMO_IDPS, agents: [], roles: DEMO_ROLES, suggestion: {} };
  return { idps: DEMO_IDPS, agents: DEMO_AGENTS, roles: DEMO_ROLES, suggestion: {} };
}
