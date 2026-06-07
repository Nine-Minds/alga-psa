'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';

interface TrustedIdp {
  issuer: string;
  jwks_uri: string;
  audience: string | null;
  subject_claim: string;
  active: boolean;
}
interface Agent {
  agent_id: string;
  name: string;
  description: string | null;
  idp_issuer: string | null;
  idp_subject: string | null;
  active: boolean;
}
interface Role {
  role_id: string;
  role_name: string;
}
interface AuditRow {
  agent_id: string;
  tool: string;
  ok: boolean;
  decision: string | null;
  status_code: number | null;
  created_at: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
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
  const [idpForm, setIdpForm] = useState({ issuer: '', jwksUri: '', audience: '', subjectClaim: 'sub' });
  // Create-agent form
  const [agentForm, setAgentForm] = useState({ name: '', idpIssuer: '', idpSubject: '', roleIds: [] as string[] });

  const reloadIdps = useCallback(() => api<{ data: TrustedIdp[] }>('/api/v1/mcp/idp-providers').then((r) => setIdps(r.data)), []);
  const reloadAgents = useCallback(() => api<{ data: Agent[] }>('/api/v1/mcp/agents').then((r) => setAgents(r.data)), []);
  const reloadRoles = useCallback(() => api<{ data: Role[] }>('/api/v1/mcp/roles').then((r) => setRoles(r.data)), []);

  useEffect(() => {
    Promise.all([reloadIdps(), reloadAgents(), reloadRoles()]).catch((e) => setError(String(e.message ?? e)));
  }, [reloadIdps, reloadAgents, reloadRoles]);

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
      setIdpForm({ issuer: '', jwksUri: '', audience: '', subjectClaim: 'sub' });
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
      const r = await api<{ data: AuditRow[] }>(`/api/v1/mcp/audit?agentId=${encodeURIComponent(agentId)}`);
      setAudit(r.data);
    });

  const toggleRole = (roleId: string) =>
    setAgentForm((f) => ({
      ...f,
      roleIds: f.roleIds.includes(roleId) ? f.roleIds.filter((r) => r !== roleId) : [...f.roleIds, roleId],
    }));

  return (
    <div id="mcp-server-settings" className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))]">MCP Server</h2>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          Govern AI-agent access to AlgaPSA: trust your identity provider, provision agents, scope them to roles, and review their activity.
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
          <CardTitle>Trusted Identity Providers</CardTitle>
          <CardDescription>OAuth issuers whose tokens are accepted for agent authentication.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[rgb(var(--color-text-600))]">
                <th className="py-1">Issuer</th><th>JWKS URI</th><th>Audience</th><th>Subject claim</th>
              </tr>
            </thead>
            <tbody>
              {idps.length === 0 && <tr><td colSpan={4} className="py-2 text-[rgb(var(--color-text-500))]">No trusted IdPs yet.</td></tr>}
              {idps.map((p) => (
                <tr key={p.issuer} className="border-t border-[rgb(var(--color-border-200))]">
                  <td className="py-1 font-mono text-xs">{p.issuer}</td>
                  <td className="font-mono text-xs">{p.jwks_uri}</td>
                  <td className="font-mono text-xs">{p.audience ?? '—'}</td>
                  <td>{p.subject_claim}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><Label htmlFor="idp-issuer">Issuer</Label><Input id="idp-issuer" value={idpForm.issuer} onChange={(e) => setIdpForm({ ...idpForm, issuer: e.target.value })} placeholder="https://login.example.com/tenant" /></div>
            <div><Label htmlFor="idp-jwks">JWKS URI</Label><Input id="idp-jwks" value={idpForm.jwksUri} onChange={(e) => setIdpForm({ ...idpForm, jwksUri: e.target.value })} placeholder="https://login.example.com/.../jwks" /></div>
            <div><Label htmlFor="idp-audience">Audience (resource)</Label><Input id="idp-audience" value={idpForm.audience} onChange={(e) => setIdpForm({ ...idpForm, audience: e.target.value })} placeholder="https://your-alga/api/mcp" /></div>
            <div><Label htmlFor="idp-claim">Subject claim</Label><Input id="idp-claim" value={idpForm.subjectClaim} onChange={(e) => setIdpForm({ ...idpForm, subjectClaim: e.target.value })} placeholder="sub | azp | client_id" /></div>
          </div>
          <Button id="mcp-add-idp" onClick={addIdp} disabled={busy || !idpForm.issuer || !idpForm.jwksUri}>Add trusted IdP</Button>
        </CardContent>
      </Card>

      {/* Agents */}
      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
          <CardDescription>Provisioned AI agents, each bound to an IdP subject and scoped to roles.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[rgb(var(--color-text-600))]"><th className="py-1">Name</th><th>IdP subject</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {agents.length === 0 && <tr><td colSpan={4} className="py-2 text-[rgb(var(--color-text-500))]">No agents yet.</td></tr>}
              {agents.map((a) => (
                <tr key={a.agent_id} className="border-t border-[rgb(var(--color-border-200))]">
                  <td className="py-1">{a.name}</td>
                  <td className="font-mono text-xs">{a.idp_subject ?? '—'}</td>
                  <td>{a.active ? 'Active' : 'Inactive'}</td>
                  <td className="text-right space-x-2">
                    <Button id={`mcp-audit-${a.agent_id}`} variant="outline" size="sm" onClick={() => loadAudit(a.agent_id)}>View audit</Button>
                    {a.active && (
                      <Button id={`mcp-deactivate-${a.agent_id}`} variant="outline" size="sm" onClick={() => run(async () => { await api(`/api/v1/mcp/agents`, { method: 'POST', body: JSON.stringify({ ...a, deactivate: true }) }).catch(() => {}); })}>Deactivate</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><Label htmlFor="agent-name">Name</Label><Input id="agent-name" value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} placeholder="Support triage bot" /></div>
            <div><Label htmlFor="agent-issuer">IdP issuer</Label><Input id="agent-issuer" value={agentForm.idpIssuer} onChange={(e) => setAgentForm({ ...agentForm, idpIssuer: e.target.value })} placeholder="https://login.example.com/tenant" /></div>
            <div><Label htmlFor="agent-subject">IdP subject / client_id</Label><Input id="agent-subject" value={agentForm.idpSubject} onChange={(e) => setAgentForm({ ...agentForm, idpSubject: e.target.value })} placeholder="the agent's IdP identifier" /></div>
          </div>
          <div>
            <Label>Roles</Label>
            <div className="mt-1 flex flex-wrap gap-3">
              {roles.map((r) => (
                <label key={r.role_id} className="flex items-center gap-1 text-sm">
                  <input id={`agent-role-${r.role_id}`} type="checkbox" checked={agentForm.roleIds.includes(r.role_id)} onChange={() => toggleRole(r.role_id)} />
                  {r.role_name}
                </label>
              ))}
            </div>
          </div>
          <Button id="mcp-create-agent" onClick={createAgent} disabled={busy || !agentForm.name}>Provision agent</Button>
        </CardContent>
      </Card>

      {/* Audit */}
      {audit.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Agent audit</CardTitle><CardDescription>Recent tool invocations for the selected agent.</CardDescription></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[rgb(var(--color-text-600))]"><th className="py-1">When</th><th>Tool</th><th>Decision</th><th>Status</th></tr></thead>
              <tbody>
                {audit.map((row, i) => (
                  <tr key={i} className="border-t border-[rgb(var(--color-border-200))]">
                    <td className="py-1">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="font-mono text-xs">{row.tool}</td>
                    <td>{row.decision}</td>
                    <td>{row.status_code ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
