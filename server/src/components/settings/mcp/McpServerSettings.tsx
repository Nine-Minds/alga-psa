'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, MoreVertical } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@alga-psa/ui/components/DropdownMenu';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import ConnectedClientsCard from './ConnectedClientsCard';
import type { ColumnDefinition } from '@alga-psa/types';
import type { TrustedIdp, Agent, Role, AuditRow, PlatformProvider, ConnectIdentity } from './mcpTypes';
import { getMcpDemoMode, demoState, demoAuditPage, demoConnectResult } from './mcpDemoData';

const AUDIT_PAGE_SIZE = 10;

const PROVIDER_NAME: Record<'microsoft' | 'google', string> = { microsoft: 'Microsoft', google: 'Google' };

function providerLabel(kind?: TrustedIdp['kind']): string {
  if (kind === 'microsoft') return 'Microsoft Entra';
  if (kind === 'google') return 'Google';
  return 'Custom';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The human-meaningful identifier for a provider row (tenant for Entra, host otherwise). */
function providerDirectory(p: TrustedIdp): string {
  if (p.kind === 'microsoft') return p.entra_tenant_id || hostOf(p.issuer);
  return hostOf(p.issuer);
}

/** The provider an agent signs in through, resolved from the trusted-provider list or a platform issuer. */
function agentProvider(a: Agent, idps: TrustedIdp[]): string {
  const idp = idps.find((p) => p.issuer === a.idp_issuer);
  if (idp) return providerLabel(idp.kind);
  const iss = a.idp_issuer ?? '';
  if (/login\.microsoftonline\.com/.test(iss)) return 'Microsoft';
  if (iss === 'https://accounts.google.com') return 'Google';
  return iss ? hostOf(iss) : '—';
}

/**
 * What to enter as the Agent ID depends on the chosen provider and the claim it
 * identifies agents by — the value must match whatever lands in that claim of the
 * agent's token (see resolveAgentByIdp in ee/.../mcp/idpToken.ts).
 */
function agentIdHelp(idp?: TrustedIdp): { placeholder: string; helper: string } {
  if (!idp) {
    return { placeholder: "the agent's identifier", helper: 'Pick a provider to see what to enter.' };
  }
  const claim = (idp.subject_claim || '').toLowerCase();
  if (idp.kind === 'microsoft') {
    return claim === 'oid' || claim === 'sub'
      ? { placeholder: 'e.g. 00000000-0000-0000-0000-000000000000', helper: "The agent's user object ID (oid) from Entra." }
      : { placeholder: 'e.g. 00000000-0000-0000-0000-000000000000', helper: "The app's Application (client) ID from Entra." };
  }
  if (idp.kind === 'google') {
    return { placeholder: 'e.g. 113029283849283742983', helper: "The service account's ID (the sub value in its token)." };
  }
  return { placeholder: 'value of your subject claim', helper: `The value of the "${idp.subject_claim || 'sub'}" claim in the agent's token.` };
}

/** A card header that carries its place in the setup sequence. */
function StepHeading({ step, title, description }: { step: number; title: string; description: string }) {
  return (
    <CardHeader>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--color-primary-600))] text-xs font-semibold text-white">
          {step}
        </span>
        <CardTitle>{title}</CardTitle>
      </div>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const friendly =
      res.status === 404 ? "MCP settings aren't available here. The MCP server may be turned off." :
      res.status === 401 ? 'Your session expired. Sign in again.' :
      `Something went wrong (${res.status}).`;
    throw new Error(body?.error || friendly);
  }
  return body as T;
}

export default function McpServerSettings() {
  const [idps, setIdps] = useState<TrustedIdp[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditAgent, setAuditAgent] = useState<Agent | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Agent | null>(null);

  // Add-IdP form
  const [idpForm, setIdpForm] = useState({ kind: 'microsoft', entraTenantId: '', issuer: '', jwksUri: '', audience: '', subjectClaim: '' });
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Create-agent form
  const [agentForm, setAgentForm] = useState({ name: '', idpIssuer: '', idpSubject: '', roleIds: [] as string[] });
  const [suggestion, setSuggestion] = useState<{ microsoft?: { entraTenantId: string; displayName: string | null } }>({});
  // Hosted shared apps available for zero-config provisioning.
  const [platformProviders, setPlatformProviders] = useState<PlatformProvider[]>([]);
  // Identity auto-discovered via "Connect with…" (null = none yet).
  const [connected, setConnected] = useState<ConnectIdentity | null>(null);
  // Reveal the manual provider+Agent-ID fields (for unattended service accounts).
  const [manualIdentity, setManualIdentity] = useState(false);
  // Expand the manual add-provider form (auto-expanded when no platform providers exist).
  const [showAddProvider, setShowAddProvider] = useState(false);

  // Dev-only: preview populated UI states without the EE backend (?mcpDemo=...).
  const demoMode = getMcpDemoMode();

  const reloadIdps = useCallback(() => api<{ data: TrustedIdp[] }>('/api/v1/mcp/idp-providers').then((r) => setIdps(r.data)), []);
  const reloadAgents = useCallback(() => api<{ data: Agent[] }>('/api/v1/mcp/agents').then((r) => setAgents(r.data)), []);
  const reloadRoles = useCallback(() => api<{ data: Role[] }>('/api/v1/mcp/roles').then((r) => setRoles(r.data)), []);

  useEffect(() => {
    if (demoMode) {
      const s = demoState(demoMode);
      setIdps(s.idps);
      setAgents(s.agents);
      setRoles(s.roles);
      setSuggestion(s.suggestion);
      setPlatformProviders(s.platformProviders);
      return;
    }
    Promise.all([reloadIdps(), reloadAgents(), reloadRoles()]).catch((e) => {
      console.error('Failed to load MCP settings:', e);
      setError('Failed to load MCP settings.');
    });
    api<{ data: { microsoft?: { entraTenantId: string; displayName: string | null } } }>('/api/v1/mcp/idp-suggestions')
      .then((r) => setSuggestion(r.data))
      .catch(() => {});
    api<{ data: PlatformProvider[] }>('/api/v1/mcp/platform-providers')
      .then((r) => setPlatformProviders(r.data))
      .catch(() => {});
  }, [demoMode, reloadIdps, reloadAgents, reloadRoles]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error('Failed to update MCP settings:', e);
      setError('Failed to update MCP settings.');
    } finally {
      setBusy(false);
    }
  };

  const addIdp = () =>
    run(async () => {
      await api('/api/v1/mcp/idp-providers', { method: 'POST', body: JSON.stringify(idpForm) });
      setIdpForm({ kind: 'microsoft', entraTenantId: '', issuer: '', jwksUri: '', audience: '', subjectClaim: '' });
      await reloadIdps();
    });

  const createAgent = () =>
    run(async () => {
      if (demoMode) {
        const demoAgent: Agent = {
          agent_id: `demo-${agents.length + 1}`,
          name: agentForm.name,
          description: null,
          idp_issuer: agentForm.idpIssuer || null,
          idp_subject: agentForm.idpSubject || null,
          active: true,
        };
        setAgents((list) => [demoAgent, ...list]);
      } else {
        await api('/api/v1/mcp/agents', { method: 'POST', body: JSON.stringify(agentForm) });
        await reloadAgents();
      }
      setAgentForm({ name: '', idpIssuer: '', idpSubject: '', roleIds: [] });
      setConnected(null);
      setManualIdentity(false);
    });

  /** Pre-fill the agent form from an auto-discovered identity. */
  const applyConnected = (identity: ConnectIdentity) => {
    setConnected(identity);
    setManualIdentity(false);
    setAgentForm((f) => ({ ...f, idpIssuer: identity.issuer, idpSubject: identity.subject, name: f.name || identity.label }));
  };

  const resetConnected = () => {
    setConnected(null);
    setAgentForm((f) => ({ ...f, idpIssuer: '', idpSubject: '' }));
  };

  /** Run the "Connect with…" OAuth popup and pre-fill the agent identity from the result. */
  const connect = (provider: 'microsoft' | 'google') =>
    run(async () => {
      if (demoMode) {
        applyConnected(demoConnectResult(provider));
        return;
      }
      const { authUrl } = await api<{ authUrl: string }>('/api/v1/mcp/connect/start', {
        method: 'POST',
        body: JSON.stringify({ provider }),
      });
      await new Promise<void>((resolve, reject) => {
        const popup = window.open(authUrl, 'mcp-connect', 'width=600,height=720,menubar=no,toolbar=no');
        if (!popup) {
          reject(new Error('Popup blocked — allow popups for this site and try again.'));
          return;
        }
        const onMessage = (event: MessageEvent) => {
          // Same-origin only: the callback page posts from our own origin.
          if (event.origin !== window.location.origin) return;
          const d = event.data as { type?: string; provider?: string; success?: boolean; error?: string; data?: ConnectIdentity };
          if (!d || d.type !== 'oauth-callback' || d.provider !== provider) return;
          cleanup();
          if (d.success && d.data) {
            applyConnected(d.data);
            resolve();
          } else {
            reject(new Error(d.error || 'Connect failed.'));
          }
        };
        const poll = setInterval(() => {
          if (popup.closed) {
            cleanup();
            resolve(); // closed without finishing — leave the form unchanged
          }
        }, 500);
        function cleanup() {
          clearInterval(poll);
          window.removeEventListener('message', onMessage);
        }
        window.addEventListener('message', onMessage);
      });
    });

  const loadAudit = (agent: Agent, page = 1) =>
    run(async () => {
      setAuditAgent(agent);
      if (demoMode) {
        const { rows, total } = demoAuditPage(agent.agent_id, page, AUDIT_PAGE_SIZE);
        setAudit(rows);
        setAuditTotal(total);
        setAuditPage(page);
        return;
      }
      const r = await api<{ data: AuditRow[]; total: number }>(
        `/api/v1/mcp/audit?agentId=${encodeURIComponent(agent.agent_id)}&page=${page}&pageSize=${AUDIT_PAGE_SIZE}`,
      );
      setAudit(r.data);
      setAuditTotal(r.total);
      setAuditPage(page);
    });

  const toggleRole = (roleId: string) =>
    setAgentForm((f) => ({
      ...f,
      roleIds: f.roleIds.includes(roleId) ? f.roleIds.filter((r) => r !== roleId) : [...f.roleIds, roleId],
    }));

  const setAgentActive = (a: Agent, active: boolean) =>
    run(async () => {
      setAgents((list) => list.map((x) => (x.agent_id === a.agent_id ? { ...x, active } : x)));
      if (!demoMode) {
        await api('/api/v1/mcp/agents', { method: 'PATCH', body: JSON.stringify({ agentId: a.agent_id, active }) });
      }
    });

  const removeAgent = (a: Agent) =>
    run(async () => {
      if (demoMode) {
        setAgents((list) => list.filter((x) => x.agent_id !== a.agent_id));
      } else {
        await api(`/api/v1/mcp/agents?agentId=${encodeURIComponent(a.agent_id)}`, { method: 'DELETE' });
        await reloadAgents();
      }
      if (auditAgent?.agent_id === a.agent_id) {
        setAudit([]);
        setAuditAgent(null);
      }
      setRemoveTarget(null);
    });

  const idpColumns: ColumnDefinition<TrustedIdp>[] = [
    {
      title: 'Provider',
      dataIndex: 'kind',
      width: '28%',
      render: (_v, p) => <span className="font-medium text-[rgb(var(--color-text-900))]">{providerLabel(p.kind)}</span>,
    },
    {
      title: 'Directory',
      dataIndex: 'issuer',
      render: (_v, p) => (
        <span className="font-mono text-xs text-[rgb(var(--color-text-700))]">{providerDirectory(p)}</span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      width: '120px',
      sortable: false,
      render: (_v, p) => <Badge variant={p.active ? 'success' : 'default-muted'}>{p.active ? 'Active' : 'Inactive'}</Badge>,
    },
  ];

  const agentIdGuide = agentIdHelp(idps.find((p) => p.issuer === agentForm.idpIssuer));
  const availablePlatform = platformProviders.filter((p) => p.available);
  const canAddAgents = idps.length > 0 || availablePlatform.length > 0;
  // The manual add-provider form shows by default only when there are no ready-to-use platform apps.
  const showProviderForm = availablePlatform.length === 0 || showAddProvider;
  // The manual identity fields need a registered provider to pick from.
  const showManualIdentity = idps.length > 0 && (availablePlatform.length === 0 || manualIdentity);

  const agentColumns: ColumnDefinition<Agent>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      width: '20%',
      render: (_v, a) => <span className="font-medium text-[rgb(var(--color-text-900))]">{a.name}</span>,
    },
    {
      title: 'Provider',
      dataIndex: 'idp_issuer',
      width: '15%',
      render: (_v, a) => <span className="text-[rgb(var(--color-text-700))]">{agentProvider(a, idps)}</span>,
    },
    {
      title: 'Agent ID',
      dataIndex: 'idp_subject',
      render: (_v, a) => (
        <span className="font-mono text-xs text-[rgb(var(--color-text-700))]">{a.idp_subject ?? '—'}</span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      width: '96px',
      sortable: false,
      render: (_v, a) => <Badge variant={a.active ? 'success' : 'default-muted'}>{a.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      title: '',
      dataIndex: 'agent_id',
      width: '64px',
      sortable: false,
      render: (_v, a) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id={`mcp-agent-actions-${a.agent_id}`} variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                <span className="sr-only">Open agent actions</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem id={`mcp-audit-${a.agent_id}`} onClick={() => loadAudit(a)}>View activity</DropdownMenuItem>
              {a.active ? (
                <DropdownMenuItem id={`mcp-deactivate-${a.agent_id}`} disabled={busy} onClick={() => setAgentActive(a, false)}>Deactivate</DropdownMenuItem>
              ) : (
                <DropdownMenuItem id={`mcp-reactivate-${a.agent_id}`} disabled={busy} onClick={() => setAgentActive(a, true)}>Reactivate</DropdownMenuItem>
              )}
              <DropdownMenuItem id={`mcp-remove-${a.agent_id}`} className="text-destructive focus:text-destructive" disabled={busy} onClick={() => setRemoveTarget(a)}>Remove…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const auditColumns: ColumnDefinition<AuditRow>[] = [
    {
      title: 'When',
      dataIndex: 'created_at',
      width: '26%',
      render: (_v, r) => <span className="text-[rgb(var(--color-text-700))]">{new Date(r.created_at).toLocaleString()}</span>,
    },
    {
      title: 'Action',
      dataIndex: 'tool',
      render: (_v, r) => <span className="font-mono text-xs text-[rgb(var(--color-text-700))]">{r.tool}</span>,
    },
    {
      title: 'Result',
      dataIndex: 'decision',
      width: '130px',
      sortable: false,
      render: (_v, r) =>
        r.decision ? (
          <Badge variant={r.decision === 'allow' ? 'success' : 'error'}>{r.decision === 'allow' ? 'Allowed' : 'Blocked'}</Badge>
        ) : (
          <span className="text-[rgb(var(--color-text-500))]">—</span>
        ),
    },
    {
      title: 'Status',
      dataIndex: 'status_code',
      width: '90px',
      sortable: false,
      render: (_v, r) => <span className="font-mono text-xs text-[rgb(var(--color-text-600))]">{r.status_code ?? '—'}</span>,
    },
  ];

  return (
    <div id="mcp-server-settings" className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))]">MCP Server</h2>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          Let AI agents sign in to AlgaPSA and act with the roles you give them.
        </p>
      </div>

      {error && (
        <div id="mcp-error" className="rounded-md border border-[rgb(var(--badge-error-border))] bg-[rgb(var(--badge-error-bg))] px-3 py-2 text-sm text-[rgb(var(--badge-error-text))]">
          {error}
        </div>
      )}

      {/* Step 1 — Trusted providers */}
      <Card>
        <StepHeading step={1} title="Identity providers" description="Agents sign in through these providers. Add the ones your agents use." />
        <CardContent className="space-y-4">
          {idps.length > 0 ? (
            <DataTable data={idps} columns={idpColumns} pagination={false} />
          ) : availablePlatform.length === 0 ? (
            <p className="text-sm text-[rgb(var(--color-text-500))]">No providers yet.</p>
          ) : null}

          {availablePlatform.length > 0 && (
            <div id="mcp-platform-providers" className="space-y-2">
              {availablePlatform.map((p) => (
                <div
                  key={p.provider}
                  id={`mcp-platform-${p.provider}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 py-2 text-sm"
                >
                  <span className="font-medium text-[rgb(var(--color-text-900))]">{p.label}</span>
                  <Badge variant="success">Ready to use</Badge>
                </div>
              ))}
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                Managed by AlgaPSA — no setup needed. Connect an agent to one in step 2.
              </p>
            </div>
          )}
          {suggestion.microsoft && !idps.some((p) => p.kind === 'microsoft') && (
            <div id="mcp-ms-suggestion" className="flex items-center justify-between gap-3 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 py-2 text-sm text-[rgb(var(--color-text-600))]">
              <span>You're already connected to Microsoft{suggestion.microsoft.displayName ? ` (${suggestion.microsoft.displayName})` : ''}. Use this directory for agents?</span>
              <Button
                id="mcp-use-ms-connection"
                size="sm"
                onClick={() => setIdpForm({ ...idpForm, kind: 'microsoft', entraTenantId: suggestion.microsoft!.entraTenantId })}
              >
                Use this directory
              </Button>
            </div>
          )}
          {availablePlatform.length > 0 && (
            <button
              type="button"
              id="mcp-add-provider-toggle"
              onClick={() => setShowAddProvider((v) => !v)}
              aria-expanded={showAddProvider}
              className="inline-flex items-center gap-1 text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))]"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showAddProvider ? '' : '-rotate-90'}`} />
              Add another provider
            </button>
          )}
          {showProviderForm && (
            <>
          <div className="space-y-3">
            <div className="md:w-1/2">
              <Label htmlFor="idp-kind">Provider</Label>
              <CustomSelect
                id="idp-kind"
                className="w-full"
                value={idpForm.kind}
                onValueChange={(v) => setIdpForm({ ...idpForm, kind: v })}
                options={[
                  { value: 'microsoft', label: 'Microsoft Entra' },
                  { value: 'google', label: 'Google' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
            </div>

            {idpForm.kind === 'microsoft' && (
              <div className="space-y-3">
                <div className="md:w-1/2"><Label htmlFor="idp-entra-tid">Entra tenant ID</Label><Input id="idp-entra-tid" value={idpForm.entraTenantId} onChange={(e) => setIdpForm({ ...idpForm, entraTenantId: e.target.value })} placeholder="e.g. 00000000-0000-0000-0000-000000000000" /></div>
                <button
                  type="button"
                  id="mcp-idp-advanced-toggle"
                  onClick={() => setShowAdvanced((v) => !v)}
                  aria-expanded={showAdvanced}
                  className="inline-flex items-center gap-1 text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))]"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? '' : '-rotate-90'}`} />
                  Advanced options
                </button>
                {showAdvanced && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div><Label htmlFor="idp-audience">Audience (optional)</Label><Input id="idp-audience" value={idpForm.audience} onChange={(e) => setIdpForm({ ...idpForm, audience: e.target.value })} placeholder="e.g. api://your-app-id" /></div>
                    <div><Label htmlFor="idp-claim-ms">Identify agents by</Label><Input id="idp-claim-ms" value={idpForm.subjectClaim} onChange={(e) => setIdpForm({ ...idpForm, subjectClaim: e.target.value })} placeholder="azp (default)" /><p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">Leave blank unless your provider tells you otherwise.</p></div>
                  </div>
                )}
              </div>
            )}

            {idpForm.kind === 'google' && (
              <div className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 py-2 text-sm text-[rgb(var(--color-text-600))]">Google needs no setup. Agents sign in with their Google service-account ID.</div>
            )}

            {idpForm.kind === 'custom' && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div><Label htmlFor="idp-issuer">Issuer</Label><Input id="idp-issuer" value={idpForm.issuer} onChange={(e) => setIdpForm({ ...idpForm, issuer: e.target.value })} placeholder="https://login.example.com/tenant" /></div>
                <div><Label htmlFor="idp-jwks">Signing keys URL</Label><Input id="idp-jwks" value={idpForm.jwksUri} onChange={(e) => setIdpForm({ ...idpForm, jwksUri: e.target.value })} placeholder="https://login.example.com/.../jwks" /></div>
                <div><Label htmlFor="idp-audience-c">Audience</Label><Input id="idp-audience-c" value={idpForm.audience} onChange={(e) => setIdpForm({ ...idpForm, audience: e.target.value })} placeholder="https://your-alga/api/mcp" /></div>
                <div><Label htmlFor="idp-claim-c">Identify agents by</Label><Input id="idp-claim-c" value={idpForm.subjectClaim} onChange={(e) => setIdpForm({ ...idpForm, subjectClaim: e.target.value })} placeholder="sub | azp | client_id" /></div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button
              id="mcp-add-idp"
              onClick={addIdp}
              disabled={busy || (idpForm.kind === 'microsoft' && !idpForm.entraTenantId) || (idpForm.kind === 'custom' && (!idpForm.issuer || !idpForm.jwksUri))}
            >
              Add provider
            </Button>
            {idpForm.kind === 'microsoft' && !idpForm.entraTenantId && (
              <span className="text-xs text-[rgb(var(--color-text-500))]">Enter your Entra tenant ID to continue.</span>
            )}
            {idpForm.kind === 'custom' && (!idpForm.issuer || !idpForm.jwksUri) && (
              <span className="text-xs text-[rgb(var(--color-text-500))]">Enter the issuer and signing keys URL to continue.</span>
            )}
          </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Agents */}
      <Card>
        <StepHeading step={2} title="Agents" description="Each agent signs in as itself and gets the roles you assign." />
        <CardContent className="space-y-4">
          {!canAddAgents ? (
            <p className="text-sm text-[rgb(var(--color-text-500))]">Add a provider in step 1 first. Then add agents that sign in through it.</p>
          ) : (
            <>
          {agents.length === 0 ? (
            <p className="text-sm text-[rgb(var(--color-text-500))]">No agents yet.</p>
          ) : (
            <DataTable data={agents} columns={agentColumns} pagination={false} />
          )}
          <div className="md:w-1/2">
            <Label htmlFor="agent-name">Name</Label>
            <Input id="agent-name" value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} placeholder="Support triage bot" />
          </div>

          <div className="space-y-2">
            <Label>Identity</Label>
            {connected ? (
              <div id="mcp-connected-identity" className="flex items-center justify-between gap-3 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 py-2 text-sm">
                <span className="text-[rgb(var(--color-text-700))]">
                  Connected as <span className="font-medium text-[rgb(var(--color-text-900))]">{connected.label}</span>{' '}
                  <span className="text-[rgb(var(--color-text-500))]">({PROVIDER_NAME[connected.provider]})</span>
                </span>
                <Button id="mcp-connect-reset" variant="ghost" size="sm" onClick={resetConnected}>Change</Button>
              </div>
            ) : (
              <>
                {availablePlatform.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {availablePlatform.map((p) => (
                      <Button key={p.provider} id={`mcp-connect-${p.provider}`} variant="outline" disabled={busy} onClick={() => connect(p.provider)}>
                        Connect with {p.label}
                      </Button>
                    ))}
                    {idps.length > 0 && (
                      <button
                        type="button"
                        id="mcp-manual-identity-toggle"
                        onClick={() => setManualIdentity((v) => !v)}
                        aria-expanded={manualIdentity}
                        className="text-sm font-medium text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))]"
                      >
                        {manualIdentity ? 'Hide manual entry' : 'Enter identity manually'}
                      </button>
                    )}
                  </div>
                )}
                {showManualIdentity && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <Label htmlFor="agent-issuer">Provider</Label>
                      <CustomSelect
                        id="agent-issuer"
                        className="w-full"
                        value={agentForm.idpIssuer || null}
                        onValueChange={(v) => setAgentForm({ ...agentForm, idpIssuer: v })}
                        placeholder="Choose a provider"
                        options={idps.map((p) => ({ value: p.issuer, label: `${providerLabel(p.kind)} · ${providerDirectory(p)}` }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="agent-subject">Agent ID</Label>
                      <Input id="agent-subject" value={agentForm.idpSubject} onChange={(e) => setAgentForm({ ...agentForm, idpSubject: e.target.value })} placeholder={agentIdGuide.placeholder} />
                      <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{agentIdGuide.helper}</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <Label>Roles</Label>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2">
              {roles.map((r) => (
                <Checkbox
                  key={r.role_id}
                  id={`agent-role-${r.role_id}`}
                  label={r.role_name}
                  checked={agentForm.roleIds.includes(r.role_id)}
                  onChange={() => toggleRole(r.role_id)}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button id="mcp-create-agent" onClick={createAgent} disabled={busy || !agentForm.name || !agentForm.idpIssuer || !agentForm.idpSubject}>Add agent</Button>
            {!agentForm.name ? (
              <span className="text-xs text-[rgb(var(--color-text-500))]">Name the agent to continue.</span>
            ) : !agentForm.idpIssuer || !agentForm.idpSubject ? (
              <span className="text-xs text-[rgb(var(--color-text-500))]">
                {availablePlatform.length > 0 ? 'Connect a provider — or enter an identity — to continue.' : 'Choose a provider and Agent ID to continue.'}
              </span>
            ) : null}
          </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Audit */}
      {audit.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{auditAgent ? `Activity — ${auditAgent.name}` : 'Activity'}</CardTitle><CardDescription>What it did, and whether each action was allowed.</CardDescription></CardHeader>
          <CardContent>
            <DataTable
              data={audit}
              columns={auditColumns}
              totalItems={auditTotal}
              currentPage={auditPage}
              pageSize={AUDIT_PAGE_SIZE}
              onPageChange={(page) => auditAgent && loadAudit(auditAgent, page)}
            />
          </CardContent>
        </Card>
      )}

      {/* Connected MCP clients (interactive OAuth — Alga as Authorization Server) */}
      <ConnectedClientsCard />

      <ConfirmationDialog
        id="mcp-remove-agent-dialog"
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => (removeTarget ? removeAgent(removeTarget) : undefined)}
        title="Remove agent"
        message={
          removeTarget
            ? `Remove "${removeTarget.name}"? This permanently deletes the agent, its role grants, and its activity log. It can't be undone.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        isConfirming={busy}
      />
    </div>
  );
}
