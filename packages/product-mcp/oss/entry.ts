// CE stub. The remote MCP server + governance are Enterprise-only; this surface
// is bundled into CE builds in place of the EE implementation so no EE source
// ships in CE. Route shells also gate on isEnterpriseEdition() before calling.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const enterpriseOnly = () =>
  NextResponse.json({ error: 'The MCP server is an Enterprise feature.' }, { status: 404 });

// Mirrors @ee/lib/mcp/baseUrl. The MCP discovery routes gate on
// isEnterpriseEdition() before calling this, so it is unreachable in CE; kept
// type-compatible (and harmlessly functional) so the route shells type-check
// against either edition's seam entry.
export async function resolvePublicBaseUrl(req: NextRequest): Promise<string> {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    req.nextUrl.origin ||
    'http://localhost:3000';
  return base.replace(/\/$/, '');
}

// Mirrors @ee/lib/mcp/adminAuth's McpAdminContext so the route shells type-check
// identically against either edition's seam entry.
export interface McpAdminContext {
  tenant: string;
  userId: string | null;
}

export async function handleMcpJsonRpc(_req: unknown) {
  return enterpriseOnly();
}

export async function createAgent(_input: unknown): Promise<never> {
  throw new Error('MCP agent provisioning is an Enterprise feature.');
}
export async function listAgents(_tenant: string): Promise<unknown[]> {
  return [];
}
export async function setAgentActive(_tenant?: string, _agentId?: string, _active?: boolean): Promise<void> {
  /* no-op in CE */
}
export async function deleteAgent(_tenant?: string, _agentId?: string): Promise<void> {
  /* no-op in CE */
}
export async function addTrustedIdp(_input: unknown): Promise<never> {
  throw new Error('MCP is an Enterprise feature.');
}
export async function listTrustedIdps(_tenant: string): Promise<unknown[]> {
  return [];
}
export async function listAllActiveIssuers(): Promise<string[]> {
  return [];
}
export async function listAssignableRoles(_tenant: string): Promise<unknown[]> {
  return [];
}
export async function getIdpSuggestions(_tenant: string): Promise<Record<string, unknown>> {
  return {};
}
export async function exportAgentAudit(_tenant: string, _filter?: unknown): Promise<{ rows: unknown[]; total: number }> {
  return { rows: [], total: 0 };
}
export async function authenticateMcpAdmin(_req: unknown): Promise<McpAdminContext | null> {
  return null;
}

// "Connect with Microsoft/Google" + hosted platform providers (EE-only). These
// shapes mirror @ee/lib/mcp/connectOAuth so the route shells type-check against
// either edition's seam entry.
export interface PlatformProvider {
  provider: 'microsoft' | 'google';
  label: string;
  issuer: string | null;
  available: boolean;
}
export interface ConnectIdentity {
  provider: 'microsoft' | 'google';
  issuer: string;
  subject: string;
  label: string;
}
export interface ConnectStart {
  authUrl: string;
  stateCookie: { name: string; value: string; maxAgeSeconds: number };
}

export async function listPlatformProviders(_tenant: string): Promise<PlatformProvider[]> {
  return [];
}
export async function buildConnectAuthUrl(_params: unknown): Promise<ConnectStart> {
  throw new Error('MCP is an Enterprise feature.');
}
export async function completeConnectCallback(_params: unknown): Promise<ConnectIdentity> {
  throw new Error('MCP is an Enterprise feature.');
}

// OAuth 2.1 Authorization Server (EE-only). Shapes mirror @ee/lib/mcp/oauth/* so
// the CE route shells type-check identically; routes gate on isEnterpriseEdition().
export type AuthorizePlan =
  | { kind: 'error'; status: number; message: string }
  | { kind: 'login'; location: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'consent'; clientId: string; clientName: string | null; signedRequest: string; tenant: string };
export type AuthorizeDecision =
  | { kind: 'error'; status: number; message: string }
  | { kind: 'redirect'; location: string };
export interface TokenResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export function buildAuthServerMetadata(_base: string): Record<string, unknown> {
  return {};
}
export async function prepareAuthorize(_base: string, _url: URL): Promise<AuthorizePlan> {
  return { kind: 'error', status: 404, message: 'The MCP authorization server is an Enterprise feature.' };
}
export async function completeAuthorize(_base: string, _signedRequest: string, _approve: boolean): Promise<AuthorizeDecision> {
  return { kind: 'error', status: 404, message: 'The MCP authorization server is an Enterprise feature.' };
}
export async function handleToken(_base: string, _form: URLSearchParams): Promise<TokenResult> {
  return { ok: false, status: 404, body: { error: 'invalid_request', error_description: 'Enterprise feature.' } };
}
export async function handleRevoke(_form: URLSearchParams): Promise<void> {
  /* no-op in CE */
}
export async function getPublicJwks(): Promise<{ keys: unknown[] }> {
  return { keys: [] };
}
export async function listConnectedClients(
  _tenant: string,
  _userId: string,
): Promise<Array<{ grantId: string; clientId: string; clientName: string | null; consentedAt: string }>> {
  return [];
}
export async function revokeGrant(_params: { tenant: string; userId: string; grantId?: string; clientId?: string }): Promise<number> {
  return 0;
}
export async function isAuthServerEnabled(): Promise<boolean> {
  return false;
}
