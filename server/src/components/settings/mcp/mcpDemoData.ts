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
import type { TrustedIdp, Agent, Role, AuditRow, PlatformProvider, ConnectIdentity } from './mcpTypes';

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

// Simulates the hosted shared Microsoft/Google apps being available (dev has no
// real app secrets, so listPlatformProviders would otherwise return []).
export const DEMO_PLATFORM_PROVIDERS: PlatformProvider[] = [
  { provider: 'microsoft', label: 'Microsoft', issuer: null, available: true },
  { provider: 'google', label: 'Google', issuer: GOOGLE_ISSUER, available: true },
];

/** A fake "Connect with…" result, so the popup flow can be previewed without a real IdP. */
export function demoConnectResult(provider: 'microsoft' | 'google'): ConnectIdentity {
  if (provider === 'google') {
    return { provider: 'google', issuer: GOOGLE_ISSUER, subject: '108124091823740912', label: 'ops-bot@nineminds.com' };
  }
  return {
    provider: 'microsoft',
    issuer: MS_ISSUER,
    subject: 'k3Jb9Qn2pXcV7sR1tY0wZ8aH6gL5fD4eC2bN1mQ',
    label: 'agent-bot@nineminds.com',
  };
}

// A burst of synthetic agent calls, newest first, large enough to span many pages
// so server-style pagination is exercisable.
const DEMO_AUDIT_COUNT = 137;
const DEMO_AUDIT_TOOLS = [
  'tickets.list', 'tickets.update', 'tickets.get', 'tickets.comment',
  'contacts.search', 'contacts.get', 'companies.get', 'projects.list',
  'time_entries.create', 'assets.search', 'invoices.create', 'invoices.send',
  'schedules.update',
];

function demoAuditAll(agentId: string): AuditRow[] {
  const base = Date.parse('2026-06-24T14:00:00Z');
  const rows: AuditRow[] = [];
  for (let i = 0; i < DEMO_AUDIT_COUNT; i++) {
    const blocked = i % 9 === 4;
    rows.push({
      agent_id: agentId,
      tool: DEMO_AUDIT_TOOLS[i % DEMO_AUDIT_TOOLS.length],
      ok: !blocked,
      decision: blocked ? 'deny' : 'allow',
      status_code: blocked ? 403 : 200,
      created_at: new Date(base - (i + 1) * 4_000).toISOString(),
    });
  }
  return rows;
}

/** One server-style page of the demo audit: the slice plus the full total. */
export function demoAuditPage(agentId: string, page: number, pageSize: number): { rows: AuditRow[]; total: number } {
  const all = demoAuditAll(agentId);
  const start = Math.max(0, (page - 1) * pageSize);
  return { rows: all.slice(start, start + pageSize), total: all.length };
}

export function demoState(mode: McpDemoMode): {
  idps: TrustedIdp[];
  agents: Agent[];
  roles: Role[];
  suggestion: typeof DEMO_SUGGESTION | Record<string, never>;
  platformProviders: PlatformProvider[];
} {
  // `empty` simulates a self-hosted instance with no shared apps (manual flow only);
  // the other modes simulate hosted, where the platform apps are ready to use.
  if (mode === 'empty')
    return { idps: [], agents: [], roles: DEMO_ROLES, suggestion: DEMO_SUGGESTION, platformProviders: [] };
  if (mode === 'providers')
    return { idps: DEMO_IDPS, agents: [], roles: DEMO_ROLES, suggestion: {}, platformProviders: DEMO_PLATFORM_PROVIDERS };
  return {
    idps: DEMO_IDPS,
    agents: DEMO_AGENTS,
    roles: DEMO_ROLES,
    suggestion: {},
    platformProviders: DEMO_PLATFORM_PROVIDERS,
  };
}
