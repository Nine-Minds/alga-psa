import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import { route } from '@alga-psa/emulator-host';
import type { HostEnv } from '@alga-psa/emulator-host';
import {
  HUNTRESS_AGENT_PLATFORMS,
  HUNTRESS_ESCALATION_STATUSES,
  HUNTRESS_INCIDENT_FILTER_STATUSES,
  HUNTRESS_INCIDENT_PLATFORMS,
  HUNTRESS_INDICATOR_TYPES,
  HUNTRESS_SEVERITIES,
  HuntressWireError,
} from './core';
import type { HuntressCredential, HuntressEmulatorCore, HuntressResource } from './core';

function query(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Documented filter enums are enforced; anything else is a 400 "unexpected value". */
function enumFilter(value: unknown, allowed: readonly string[], name: string): string | undefined {
  const raw = str(value);
  if (raw === undefined) return undefined;
  if (!allowed.includes(raw)) {
    throw new HuntressWireError(400, `Bad Request: ${name} must be one of ${allowed.join(', ')}`);
  }
  return raw;
}

function numberFilter(value: unknown, name: string): number | undefined {
  const raw = str(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new HuntressWireError(400, `Bad Request: ${name} must be an integer`);
  }
  return parsed;
}

/** Resource ids are documented as integers. */
function pathId(req: Request): number {
  const raw = String(req.params.id);
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new HuntressWireError(400, `Bad Request: there is an unexpected value in the API request ("${raw}")`);
  }
  return id;
}

function credentialOf(req: Request): HuntressCredential {
  return (req as Request & { huntressCredential?: HuntressCredential }).huntressCredential!;
}

/**
 * The documented pagination object: `next_page_token`, plus `next_page_url`
 * "Only displays when another page can be accessed". The URL repeats the
 * request's filters and the effective limit, as the docs' example does.
 */
function pagination(req: Request, token: string | null, limit: number): Record<string, unknown> {
  if (!token) return { next_page_token: null };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query(req))) {
    if (key === 'page_token' || key === 'limit' || typeof value !== 'string') continue;
    params.set(key, value);
  }
  params.set('page_token', token);
  params.set('limit', String(limit));
  const origin = `${req.protocol}://${req.get('host') ?? 'api.huntress.io'}`;
  return { next_page_token: token, next_page_url: `${origin}${req.baseUrl}${req.path}?${params.toString()}` };
}

/**
 * Huntress's documented `/v1` surface as Alga's HuntressClient uses it:
 * account, organizations, agents, incident reports and escalations, each
 * Basic-authenticated and cursor-paginated. Point `HUNTRESS_API_BASE_URL` (or
 * the integration card's Base URL) at this origin.
 */
export function wire(router: Router, core: HuntressEmulatorCore, _env: HostEnv): void {
  router.use(express.json());

  const v1 = express.Router();
  router.use('/v1', v1);

  // Auth precedes everything, including operation faults, as at Huntress's edge.
  v1.use((req, _res, next) => {
    try {
      const credential = core.authenticate(req.headers.authorization, {
        method: req.method,
        path: `${req.baseUrl}${req.path}`,
      });
      (req as Request & { huntressCredential?: HuntressCredential }).huntressCredential = credential;
      next();
    } catch (error) {
      next(error);
    }
  });

  const operation = (name: string) => (_req: Request, _res: Response, next: NextFunction) => {
    const fault = core.consumeOperationFault(name);
    if (!fault) return next();
    const headers: Record<string, string> = {};
    if (fault.retryAfterSeconds !== null) headers['retry-after'] = String(fault.retryAfterSeconds);
    next(new HuntressWireError(fault.status, fault.message, headers));
  };

  const listJson = <T extends { id: number }>(
    req: Request,
    res: Response,
    resource: HuntressResource,
    items: T[],
    present: (item: T) => unknown,
  ) => {
    const page = core.paginate(items, query(req), resource);
    res.json({
      [resource]: page.items.map(present),
      pagination: pagination(req, page.nextPageToken, page.limit),
    });
  };

  // ── Account ────────────────────────────────────────────────────────────

  v1.get('/account', operation('GET /v1/account'), route((_req, res) => {
    res.json({ account: core.config.account });
  }));

  // ── Organizations ──────────────────────────────────────────────────────

  v1.get('/organizations', operation('GET /v1/organizations'), route((req, res) => {
    const q = query(req);
    let organizations = [...core.organizations.values()];
    const name = str(q.name);
    if (name) organizations = organizations.filter((organization) => organization.name === name);
    const key = str(q.key);
    if (key) organizations = organizations.filter((organization) => organization.key === key);
    listJson(req, res, 'organizations', organizations, (organization) =>
      core.presentOrganization(organization, { withUsages: false }));
  }));

  v1.get('/organizations/:id', operation('GET /v1/organizations/:id'), route((req, res) => {
    res.json({ organization: core.presentOrganization(core.getOrganization(pathId(req)), { withUsages: true }) });
  }));

  // ── Agents ─────────────────────────────────────────────────────────────

  v1.get('/agents', operation('GET /v1/agents'), route((req, res) => {
    const q = query(req);
    let agents = [...core.agents.values()];
    const organizationId = numberFilter(q.organization_id, 'organization_id');
    if (organizationId !== undefined) agents = agents.filter((agent) => agent.organization_id === organizationId);
    const platform = enumFilter(q.platform, HUNTRESS_AGENT_PLATFORMS, 'platform');
    if (platform) agents = agents.filter((agent) => agent.platform === platform);
    const hostname = str(q.hostname);
    if (hostname) agents = agents.filter((agent) => agent.hostname === hostname);
    const os = str(q.os);
    if (os) agents = agents.filter((agent) => agent.os === os);
    const version = str(q.version);
    if (version) agents = agents.filter((agent) => agent.version === version);
    listJson(req, res, 'agents', agents, (agent) => agent);
  }));

  v1.get('/agents/:id', operation('GET /v1/agents/:id'), route((req, res) => {
    res.json({ agent: core.getAgent(pathId(req)) });
  }));

  // ── Incident reports ───────────────────────────────────────────────────

  v1.get('/incident_reports', operation('GET /v1/incident_reports'), route((req, res) => {
    const q = query(req);
    // "Unlike the list endpoint, [by-id] includes Incident Reports that have
    // been sent back to the Huntress SOC … a `status` of `draft`."
    let incidents = [...core.incidents.values()].filter((incident) => incident.status !== 'draft');
    const indicatorType = enumFilter(q.indicator_type, HUNTRESS_INDICATOR_TYPES, 'indicator_type');
    if (indicatorType) incidents = incidents.filter((incident) => incident.indicator_types.includes(indicatorType));
    const status = enumFilter(q.status, HUNTRESS_INCIDENT_FILTER_STATUSES, 'status');
    if (status) incidents = incidents.filter((incident) => incident.status === status);
    const severity = enumFilter(q.severity, HUNTRESS_SEVERITIES, 'severity');
    if (severity) incidents = incidents.filter((incident) => incident.severity === severity);
    const platform = enumFilter(q.platform, HUNTRESS_INCIDENT_PLATFORMS, 'platform');
    if (platform) incidents = incidents.filter((incident) => incident.platform === platform);
    const organizationId = numberFilter(q.organization_id, 'organization_id');
    if (organizationId !== undefined) incidents = incidents.filter((incident) => incident.organization_id === organizationId);
    const agentId = numberFilter(q.agent_id, 'agent_id');
    if (agentId !== undefined) incidents = incidents.filter((incident) => incident.agent_id === agentId);
    const psaTicketEid = str(q.psa_ticket_eid);
    if (psaTicketEid) incidents = incidents.filter((incident) => incident.psa_ticket_eids.includes(psaTicketEid));
    listJson(req, res, 'incident_reports', incidents, (incident) => core.presentIncident(incident));
  }));

  v1.get('/incident_reports/:id', operation('GET /v1/incident_reports/:id'), route((req, res) => {
    res.json({ incident_report: core.presentIncident(core.getIncident(pathId(req))) });
  }));

  // ── Escalations ────────────────────────────────────────────────────────

  v1.get('/escalations', operation('GET /v1/escalations'), route((req, res) => {
    const q = query(req);
    let escalations = [...core.escalations.values()];
    const status = enumFilter(q.status, HUNTRESS_ESCALATION_STATUSES, 'status');
    if (status) escalations = escalations.filter((escalation) => escalation.status === status);
    const severity = enumFilter(q.severity, HUNTRESS_SEVERITIES, 'severity');
    if (severity) escalations = escalations.filter((escalation) => escalation.severity === severity);
    const subtype = str(q.subtype);
    if (subtype) escalations = escalations.filter((escalation) => escalation.subtype === subtype);
    const organizationId = numberFilter(q.organization_id, 'organization_id');
    if (organizationId !== undefined) {
      escalations = escalations.filter((escalation) => escalation.organization_ids.includes(organizationId));
    }
    const psaTicketEid = str(q.psa_ticket_eid);
    if (psaTicketEid) escalations = escalations.filter((escalation) => escalation.psa_ticket_eids.includes(psaTicketEid));
    // The list serves Escalation; only the by-id endpoint serves
    // EscalationWithEntities.
    listJson(req, res, 'escalations', escalations, (escalation) =>
      core.presentEscalation(escalation, { withEntities: false }));
  }));

  v1.get('/escalations/:id', operation('GET /v1/escalations/:id'), route((req, res) => {
    res.json({ escalation: core.presentEscalation(core.getEscalation(pathId(req)), { withEntities: true }) });
  }));

  v1.post('/escalations/:id/resolution', operation('POST /v1/escalations/:id/resolution'), route((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { escalation, resolution_method: resolutionMethod } = core.resolveEscalation(
      pathId(req),
      {
        determination: body.determination as never,
        scope: body.scope as never,
        expiration_date: body.expiration_date as never,
        ip_address: body.ip_address as never,
        revoke_and_disable_identities: body.revoke_and_disable_identities as never,
      },
      credentialOf(req),
    );
    res.status(201).json({
      escalation: core.presentEscalation(escalation, { withEntities: true }),
      resolution_method: resolutionMethod,
    });
  }));

  // Huntress documents much more of /v1 (identities, signals, reports, SIEM,
  // reseller, remediation writes); none of it is modeled. Say so instead of
  // answering 404, which a client could read as "no such record".
  v1.use(() => {
    throw new HuntressWireError(
      501,
      'This Huntress operation is not implemented by the emulator.',
      {},
      'EmulatorUnsupportedOperation',
    );
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HuntressWireError) {
      for (const [name, value] of Object.entries(err.headers)) res.setHeader(name, value);
      res.status(err.status).json(err.toEnvelope());
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
}
