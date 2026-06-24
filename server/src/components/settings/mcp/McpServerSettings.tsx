'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import type { TrustedIdp, Agent, Role, AuditRow } from './mcpTypes';
import { getMcpDemoMode, demoState, demoAudit } from './mcpDemoData';

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

/** The provider an agent signs in through, resolved from the trusted-provider list. */
function agentProvider(a: Agent, idps: TrustedIdp[]): string {
  const idp = idps.find((p) => p.issuer === a.idp_issuer);
  if (idp) return providerLabel(idp.kind);
  return a.idp_issuer ? hostOf(a.idp_issuer) : '—';
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-IdP form
  const [idpForm, setIdpForm] = useState({ kind: 'microsoft', entraTenantId: '', issuer: '', jwksUri: '', audience: '', subjectClaim: '' });
  // Create-agent form
  const [agentForm, setAgentForm] = useState({ name: '', idpIssuer: '', idpSubject: '', roleIds: [] as string[] });
  const [suggestion, setSuggestion] = useState<{ microsoft?: { entraTenantId: string; displayName: string | null } }>({});

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
      return;
    }
    Promise.all([reloadIdps(), reloadAgents(), reloadRoles()]).catch((e) => setError(String(e.message ?? e)));
    api<{ data: { microsoft?: { entraTenantId: string; displayName: string | null } } }>('/api/v1/mcp/idp-suggestions')
      .then((r) => setSuggestion(r.data))
      .catch(() => {});
  }, [demoMode, reloadIdps, reloadAgents, reloadRoles]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      await api('/api/v1/mcp/agents', { method: 'POST', body: JSON.stringify(agentForm) });
      setAgentForm({ name: '', idpIssuer: '', idpSubject: '', roleIds: [] });
      await reloadAgents();
    });

  const loadAudit = (agentId: string) =>
    run(async () => {
      if (demoMode) {
        setAudit(demoAudit(agentId));
        return;
      }
      const r = await api<{ data: AuditRow[] }>(`/api/v1/mcp/audit?agentId=${encodeURIComponent(agentId)}`);
      setAudit(r.data);
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
        await api('/api/v1/mcp/agents', { method: 'POST', body: JSON.stringify({ ...a, deactivate: !active }) });
      }
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
        <span className="font-mono text-xs text-[rgb(var(--color-text-700))]" title={p.issuer}>{providerDirectory(p)}</span>
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

  const agentColumns: ColumnDefinition<Agent>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      width: '22%',
      render: (_v, a) => <span className="font-medium text-[rgb(var(--color-text-900))]">{a.name}</span>,
    },
    {
      title: 'Provider',
      dataIndex: 'idp_issuer',
      width: '18%',
      render: (_v, a) => <span className="text-[rgb(var(--color-text-700))]">{agentProvider(a, idps)}</span>,
    },
    {
      title: 'Agent ID',
      dataIndex: 'idp_subject',
      render: (_v, a) => (
        <span className="font-mono text-xs text-[rgb(var(--color-text-700))]" title={a.idp_subject ?? ''}>{a.idp_subject ?? '—'}</span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      width: '110px',
      sortable: false,
      render: (_v, a) => <Badge variant={a.active ? 'success' : 'default-muted'}>{a.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      title: '',
      dataIndex: 'agent_id',
      width: '190px',
      sortable: false,
      render: (_v, a) => (
        <div className="flex justify-end gap-2">
          <Button id={`mcp-audit-${a.agent_id}`} variant="outline" size="sm" onClick={() => loadAudit(a.agent_id)}>View activity</Button>
          {a.active ? (
            <Button id={`mcp-deactivate-${a.agent_id}`} variant="outline" size="sm" disabled={busy} onClick={() => setAgentActive(a, false)}>Deactivate</Button>
          ) : (
            <Button id={`mcp-reactivate-${a.agent_id}`} variant="outline" size="sm" disabled={busy} onClick={() => setAgentActive(a, true)}>Reactivate</Button>
          )}
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

      {/* Trusted IdPs */}
      <Card>
        <CardHeader>
          <CardTitle>Identity providers</CardTitle>
          <CardDescription>Agents sign in through these providers. Add the ones your agents use.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {idps.length === 0 ? (
            <p className="text-sm text-[rgb(var(--color-text-500))]">No identity providers yet.</p>
          ) : (
            <DataTable data={idps} columns={idpColumns} pagination={false} />
          )}
          {suggestion.microsoft && !idps.some((p) => p.kind === 'microsoft') && (
            <div id="mcp-ms-suggestion" className="flex items-center justify-between rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-primary-50))] px-3 py-2 text-sm dark:bg-[rgb(var(--color-primary-400)/0.15)]">
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
                  { value: 'custom', label: 'Custom (advanced)' },
                ]}
              />
            </div>

            {idpForm.kind === 'microsoft' && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div><Label htmlFor="idp-entra-tid">Entra tenant ID</Label><Input id="idp-entra-tid" value={idpForm.entraTenantId} onChange={(e) => setIdpForm({ ...idpForm, entraTenantId: e.target.value })} placeholder="e.g. 00000000-0000-0000-0000-000000000000" /></div>
                <div><Label htmlFor="idp-audience">Audience (optional)</Label><Input id="idp-audience" value={idpForm.audience} onChange={(e) => setIdpForm({ ...idpForm, audience: e.target.value })} placeholder="e.g. api://your-app-id" /></div>
                <div><Label htmlFor="idp-claim-ms">Subject claim</Label><Input id="idp-claim-ms" value={idpForm.subjectClaim} onChange={(e) => setIdpForm({ ...idpForm, subjectClaim: e.target.value })} placeholder="azp (default)" /><p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">Leave blank unless your provider tells you otherwise.</p></div>
              </div>
            )}

            {idpForm.kind === 'google' && (
              <p className="text-sm text-[rgb(var(--color-text-600))]">Nothing to configure — Google's issuer &amp; keys are well-known. An agent's subject is its service-account id (<code>sub</code>).</p>
            )}

            {idpForm.kind === 'custom' && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div><Label htmlFor="idp-issuer">Issuer</Label><Input id="idp-issuer" value={idpForm.issuer} onChange={(e) => setIdpForm({ ...idpForm, issuer: e.target.value })} placeholder="https://login.example.com/tenant" /></div>
                <div><Label htmlFor="idp-jwks">JWKS URI</Label><Input id="idp-jwks" value={idpForm.jwksUri} onChange={(e) => setIdpForm({ ...idpForm, jwksUri: e.target.value })} placeholder="https://login.example.com/.../jwks" /></div>
                <div><Label htmlFor="idp-audience-c">Audience (resource)</Label><Input id="idp-audience-c" value={idpForm.audience} onChange={(e) => setIdpForm({ ...idpForm, audience: e.target.value })} placeholder="https://your-alga/api/mcp" /></div>
                <div><Label htmlFor="idp-claim-c">Subject claim</Label><Input id="idp-claim-c" value={idpForm.subjectClaim} onChange={(e) => setIdpForm({ ...idpForm, subjectClaim: e.target.value })} placeholder="sub | azp | client_id" /></div>
              </div>
            )}
          </div>
          <Button
            id="mcp-add-idp"
            onClick={addIdp}
            disabled={busy || (idpForm.kind === 'microsoft' && !idpForm.entraTenantId) || (idpForm.kind === 'custom' && (!idpForm.issuer || !idpForm.jwksUri))}
          >
            Add provider
          </Button>
        </CardContent>
      </Card>

      {/* Agents */}
      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
          <CardDescription>Each agent signs in as itself and gets the roles you assign.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {agents.length === 0 ? (
            <p className="text-sm text-[rgb(var(--color-text-500))]">No agents yet.</p>
          ) : (
            <DataTable data={agents} columns={agentColumns} pagination={false} />
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><Label htmlFor="agent-name">Name</Label><Input id="agent-name" value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} placeholder="Support triage bot" /></div>
            <div>
              <Label htmlFor="agent-issuer">Identity provider</Label>
              <CustomSelect
                id="agent-issuer"
                className="w-full"
                value={agentForm.idpIssuer || null}
                onValueChange={(v) => setAgentForm({ ...agentForm, idpIssuer: v })}
                disabled={idps.length === 0}
                placeholder={idps.length === 0 ? 'Add a provider first' : 'Choose a provider'}
                options={idps.map((p) => ({ value: p.issuer, label: `${providerLabel(p.kind)} · ${providerDirectory(p)}` }))}
              />
            </div>
            <div><Label htmlFor="agent-subject">Agent ID</Label><Input id="agent-subject" value={agentForm.idpSubject} onChange={(e) => setAgentForm({ ...agentForm, idpSubject: e.target.value })} placeholder="the agent's client_id or sub" /><p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">The agent's own identifier at your provider.</p></div>
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
          <Button id="mcp-create-agent" onClick={createAgent} disabled={busy || !agentForm.name || (idps.length > 0 && !agentForm.idpIssuer)}>Add agent</Button>
        </CardContent>
      </Card>

      {/* Audit */}
      {audit.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Activity</CardTitle><CardDescription>What this agent did, and whether each action was allowed.</CardDescription></CardHeader>
          <CardContent>
            <DataTable data={audit} columns={auditColumns} pagination={false} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
