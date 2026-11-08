import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_KEY, API_SECRET, basicAuth, startHuntress } from './helpers';

// The Huntress v1 REST surface as a wire contract, driven with plain fetch the
// way Huntress documents it (Authorization: Basic base64(key:secret), limit +
// page_token pagination, sort_field/sort_direction, documented filters).
// Alga's HuntressClient against this emulator is covered on the product side in
// ee/server/src/__tests__/integration/huntressEmulatorApiClient.integration.test.ts,
// so this package never imports the product.

const CREDENTIAL_ERROR = 'There was an issue with your API credential or permissions.';
let huntress: Awaited<ReturnType<typeof startHuntress>>;

async function raw(path: string, init: RequestInit = {}) {
  const response = await fetch(`${huntress.vendor}${path}`, {
    ...init,
    headers: { authorization: basicAuth(), ...(init.headers as Record<string, string>) },
  });
  return { status: response.status, headers: response.headers, body: (await response.json()) as any };
}

/** Walk a list endpoint with page_token until next_page_token is null. */
async function listAll(path: string, key: string, limit = 10) {
  const items: any[] = [];
  let pageToken: string | undefined;
  const tokens: Array<string | null> = [];
  for (;;) {
    const separator = path.includes('?') ? '&' : '?';
    const cursor = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '';
    const page = await raw(`${path}${separator}limit=${limit}${cursor}`);
    expect(page.status).toBe(200);
    items.push(...page.body[key]);
    tokens.push(page.body.pagination.next_page_token);
    if (!page.body.pagination.next_page_token) return { items, tokens };
    pageToken = page.body.pagination.next_page_token;
  }
}

beforeAll(async () => {
  huntress = await startHuntress();
});

afterAll(async () => {
  await huntress.host.stop();
});

beforeEach(async () => {
  await huntress.reset();
});

describe('Huntress v1 REST surface', () => {
  it('accepts Basic key:secret and answers the documented 403 otherwise', async () => {
    expect((await raw('/v1/account')).status).toBe(200);

    const rejected: Array<Record<string, string>> = [
      {},
      { authorization: basicAuth('wrong-key', API_SECRET) },
      { authorization: basicAuth(API_KEY, 'wrong-secret') },
      // The documented scheme is Basic; a bearer token is not it.
      { authorization: `Bearer ${API_KEY}` },
    ];
    for (const headers of rejected) {
      const response = await fetch(`${huntress.vendor}/v1/organizations`, { headers });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: CREDENTIAL_ERROR });
    }

    const failures = await huntress.state('auth-failures');
    expect(failures.map((f: { reason: string }) => f.reason)).toEqual([
      'missing',
      'unknown_credential',
      'unknown_credential',
      'not_basic',
    ]);
    expect(failures[0]).toMatchObject({ method: 'GET', path: '/v1/organizations', authorization: null });

    // A second credential pair is accepted once seeded.
    await huntress.seed('credential', { key: 'second-key', secret: 'second-secret' });
    const second = await fetch(`${huntress.vendor}/v1/account`, {
      headers: { authorization: basicAuth('second-key', 'second-secret') },
    });
    expect(second.status).toBe(200);
  });

  it('wraps the account in an { account } object, as the Account operation documents', async () => {
    await huntress.action('configure', { accountName: 'Acme MSP', accountSubdomain: 'acme' });
    const account = await raw('/v1/account');
    expect(account.body).toEqual({
      account: {
        id: 1,
        name: 'Acme MSP',
        subdomain: 'acme',
        status: 'enabled',
        support_type: 'huntress_supported',
        neighborhood_watch: { edr: 0, ispm: 0, itdr: 0, sat: 0, siem: 0 },
        billing_address: null,
        shipping_address: null,
      },
    });
  });

  it('serves organizations with their documented fields, filters, and detail-only usages', async () => {
    const acme = (await huntress.seed('organization', {
      name: 'Acme Inc.',
      key: 'acme',
      agents_count: 42,
      incident_reports_count: 7,
      report_recipients: ['soc@acme.test'],
      identity_provider_tenant_id: 'dcd219dd-bc68-4b9b-bf0b-4a33a796be35',
      actual_usages: { siem: { billable_log_sources_count: 5 } },
    })).organizations[0];
    await huntress.seed('organization', { name: 'Globex', key: 'globex' });

    const list = await raw('/v1/organizations');
    expect(list.body.organizations).toHaveLength(2);
    expect(list.body.organizations.map((o: { name: string }) => o.name)).toEqual(['Globex', 'Acme Inc.']); // id desc default
    expect(list.body.organizations[1]).toEqual({
      id: acme.id,
      account_id: 1,
      name: 'Acme Inc.',
      key: 'acme',
      agents_count: 42,
      incident_reports_count: 7,
      logs_sources_count: 0,
      identity_provider_tenant_id: 'dcd219dd-bc68-4b9b-bf0b-4a33a796be35',
      billable_identity_count: 0,
      sat_learner_count: 0,
      report_recipients: ['soc@acme.test'],
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    // actual_usages belongs to OrganizationWithActualProductUsages — detail only.
    expect(list.body.organizations[1].actual_usages).toBeUndefined();

    const detail = await raw(`/v1/organizations/${acme.id}`);
    expect(detail.body.organization.actual_usages).toEqual({ siem: { billable_log_sources_count: 5 } });

    expect((await raw('/v1/organizations?name=Globex')).body.organizations.map((o: any) => o.key)).toEqual(['globex']);
    expect((await raw('/v1/organizations?key=acme')).body.organizations.map((o: any) => o.id)).toEqual([acme.id]);
    expect((await raw('/v1/organizations?sort_field=name&sort_direction=asc')).body.organizations.map((o: any) => o.name))
      .toEqual(['Acme Inc.', 'Globex']);

    const missing = await raw('/v1/organizations/9999');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Not Found' });
  });

  it('serves agents with their documented fields and filters', async () => {
    const org = (await huntress.seed('organization', { name: 'Acme Inc.' })).organizations[0];
    const srv = (await huntress.seed('agent', {
      hostname: 'SRV01',
      organization_id: org.id,
      platform: 'windows',
      os: 'Windows Server 2022',
      os_major: 10,
      os_minor: 0,
      os_build_version: '20348',
      arch: 'x86_64',
      version: '0.13.14',
      edr_version: '0.3.20',
      external_ip: '198.51.100.42',
      ipv4_address: '10.0.0.5',
      mac_addresses: ['7c:a7:b0:16:2f:78'],
      serial_number: 'SN-1',
      domain_name: 'WORKGROUP',
      defender_status: 'Healthy',
      firewall_status: 'Enabled',
      tamper_protection_configured: true,
      tamper_protection_actual: true,
      tags: ['Server', 'Production'],
    })).agent;
    await huntress.seed('agent', { hostname: 'MAC01', organization_id: org.id, platform: 'darwin', os: 'macOS 14' });

    const detail = await raw(`/v1/agents/${srv.id}`);
    expect(detail.body.agent).toMatchObject({
      id: srv.id,
      account_id: 1,
      organization_id: org.id,
      hostname: 'SRV01',
      platform: 'windows',
      os: 'Windows Server 2022',
      os_major: 10,
      os_build_version: '20348',
      arch: 'x86_64',
      version: '0.13.14',
      edr_version: '0.3.20',
      external_ip: '198.51.100.42',
      ipv4_address: '10.0.0.5',
      // ipv4_address is documented as the primary entry of ipv4_addresses.
      ipv4_addresses: ['10.0.0.5'],
      mac_addresses: ['7c:a7:b0:16:2f:78'],
      serial_number: 'SN-1',
      domain_name: 'WORKGROUP',
      defender_status: 'Healthy',
      firewall_status: 'Enabled',
      tamper_protection_configured: true,
      tags: ['Server', 'Production'],
      last_callback_at: expect.any(String),
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });

    expect((await raw('/v1/agents?platform=darwin')).body.agents.map((a: any) => a.hostname)).toEqual(['MAC01']);
    expect((await raw('/v1/agents?hostname=SRV01')).body.agents.map((a: any) => a.id)).toEqual([srv.id]);
    expect((await raw('/v1/agents?os=macOS%2014')).body.agents).toHaveLength(1);
    expect((await raw('/v1/agents?version=0.13.14')).body.agents).toHaveLength(1);
    expect((await raw(`/v1/agents?organization_id=${org.id}`)).body.agents).toHaveLength(2);
    expect((await raw('/v1/agents?organization_id=4242')).body.agents).toEqual([]);
    expect((await raw('/v1/agents?platform=solaris')).status).toBe(400);

    const missing = await raw('/v1/agents/4242');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Not Found' });

    // A deleted agent is the "host dropped off" path.
    await huntress.action('delete-agent', { agentId: srv.id });
    expect((await raw(`/v1/agents/${srv.id}`)).status).toBe(404);
  });

  it('serves incident reports with remediations, filters and the draft rule', async () => {
    const org = (await huntress.seed('organization', { name: 'Acme Inc.' })).organizations[0];
    const agent = (await huntress.seed('agent', { hostname: 'laptop01', organization_id: org.id })).agent;
    const incident = (await huntress.seed('incident', {
      organization_id: org.id,
      agent_id: agent.id,
      subject: 'LOW - Incident on laptop01 (Test)',
      summary: 'Huntress detected a malicious scheduled task on this host.',
      body: '<Content>',
      severity: 'low',
      platform: 'windows',
      indicator_types: ['footholds'],
      indicator_counts: { footholds: 1, monitored_files: 0 },
      psa_ticket_eids: ['T-1696'],
      remediations: [
        {
          type: 'manual',
          action: 'Delete File',
          status: 'completed',
          parameters: [{ name: 'path', description: 'c:\\windows\\system32\\tasks\\malicious_task' }],
          approved_at: '2025-06-26T18:57:03Z',
          approved_by: { id: '123123', email: 'john.smith@example.com', name: 'John smith' },
          completed_at: '2025-06-26T18:57:03Z',
        },
      ],
    })).incident_report;

    const list = await raw('/v1/incident_reports');
    expect(list.body.incident_reports).toHaveLength(1);
    expect(list.body.incident_reports[0]).toEqual({
      id: incident.id,
      account_id: 1,
      agent_id: agent.id,
      organization_id: org.id,
      subject: 'LOW - Incident on laptop01 (Test)',
      summary: 'Huntress detected a malicious scheduled task on this host.',
      body: '<Content>',
      severity: 'low',
      status: 'sent',
      platform: 'windows',
      indicator_types: ['footholds'],
      indicator_counts: { footholds: 1, monitored_files: 0 },
      psa_ticket_eids: ['T-1696'],
      remediations: {
        total_count: 1,
        has_more: false,
        items: [
          {
            id: expect.any(Number),
            type: 'manual',
            action: 'Delete File',
            status: 'completed',
            parameters: [{ name: 'path', description: 'c:\\windows\\system32\\tasks\\malicious_task' }],
            approved_at: '2025-06-26T18:57:03Z',
            approved_by: { id: '123123', email: 'john.smith@example.com', name: 'John smith' },
            completed_at: '2025-06-26T18:57:03Z',
          },
        ],
      },
      sent_at: expect.any(String),
      closed_at: null,
      status_updated_at: expect.any(String),
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect((await raw(`/v1/incident_reports/${incident.id}`)).body.incident_report.id).toBe(incident.id);

    // Every documented list filter.
    expect((await raw('/v1/incident_reports?severity=low')).body.incident_reports).toHaveLength(1);
    expect((await raw('/v1/incident_reports?severity=critical')).body.incident_reports).toEqual([]);
    expect((await raw('/v1/incident_reports?status=sent')).body.incident_reports).toHaveLength(1);
    expect((await raw('/v1/incident_reports?status=closed')).body.incident_reports).toEqual([]);
    expect((await raw('/v1/incident_reports?indicator_type=footholds')).body.incident_reports).toHaveLength(1);
    expect((await raw('/v1/incident_reports?indicator_type=ai_misuse')).body.incident_reports).toEqual([]);
    expect((await raw('/v1/incident_reports?platform=windows')).body.incident_reports).toHaveLength(1);
    expect((await raw(`/v1/incident_reports?organization_id=${org.id}`)).body.incident_reports).toHaveLength(1);
    expect((await raw(`/v1/incident_reports?agent_id=${agent.id}`)).body.incident_reports).toHaveLength(1);
    expect((await raw('/v1/incident_reports?psa_ticket_eid=T-1696')).body.incident_reports).toHaveLength(1);
    expect((await raw('/v1/incident_reports?status=bogus')).status).toBe(400);

    // "Unlike the list endpoint, [by id] includes … a status of draft."
    const draft = (await huntress.seed('incident', { organization_id: org.id, status: 'draft' })).incident_report;
    expect((await raw('/v1/incident_reports')).body.incident_reports.map((i: any) => i.id)).toEqual([incident.id]);
    expect((await raw(`/v1/incident_reports/${draft.id}`)).body.incident_report.status).toBe('draft');
    // `draft` is not a documented status filter value.
    expect((await raw('/v1/incident_reports?status=draft')).status).toBe(400);

    const missing = await raw('/v1/incident_reports/4242');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Not Found' });
  });

  it('stamps status_updated_at/closed_at on a status change and bumps updated_at on a touch', async () => {
    const org = (await huntress.seed('organization', { name: 'Acme Inc.' })).organizations[0];
    const incident = (await huntress.seed('incident', { organization_id: org.id, severity: 'high' })).incident_report;
    const seededAt = incident.updated_at;

    huntress.host.clock.advance('1h');
    const closed = (await huntress.action('update-incident', { incidentId: incident.id, status: 'closed' }))
      .incident_report;
    expect(closed.status).toBe('closed');
    expect(closed.closed_at).toBe(closed.status_updated_at);
    expect(Date.parse(closed.updated_at)).toBe(Date.parse(closed.closed_at));
    expect(Date.parse(closed.updated_at)).toBeGreaterThan(Date.parse(seededAt));

    huntress.host.clock.advance('1h');
    const touched = (await huntress.action('touch-incident', { incidentId: incident.id })).incident_report;
    // A touch moves updated_at only — the "updated but unchanged status" path.
    expect(Date.parse(touched.updated_at)).toBeGreaterThan(Date.parse(closed.updated_at));
    expect(touched.status_updated_at).toBe(closed.status_updated_at);
    expect(touched.status).toBe('closed');

    const served = (await raw(`/v1/incident_reports/${incident.id}`)).body.incident_report;
    expect(served.updated_at).toBe(touched.updated_at);
  });

  it('honors sort_field/sort_direction with an id tiebreak on equal timestamps', async () => {
    const org = (await huntress.seed('organization', { name: 'Acme Inc.' })).organizations[0];
    // Three reports created in the same virtual instant: equal updated_at.
    const ids: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push((await huntress.seed('incident', { organization_id: org.id })).incident_report.id);
    }
    const tied = (await raw('/v1/incident_reports?sort_field=updated_at&sort_direction=desc')).body.incident_reports;
    expect(tied.map((i: any) => i.updated_at)).toEqual([tied[0].updated_at, tied[0].updated_at, tied[0].updated_at]);
    expect(tied.map((i: any) => i.id)).toEqual([...ids].reverse());
    expect((await raw('/v1/incident_reports?sort_field=updated_at&sort_direction=asc')).body.incident_reports.map((i: any) => i.id))
      .toEqual(ids);

    // A later update moves that report to the head of updated_at desc.
    huntress.host.clock.advance('30m');
    await huntress.action('touch-incident', { incidentId: ids[0] });
    const bumped = await raw('/v1/incident_reports?sort_field=updated_at&sort_direction=desc');
    expect(bumped.body.incident_reports.map((i: any) => i.id)).toEqual([ids[0], ids[2], ids[1]]);

    expect((await raw('/v1/incident_reports?sort_field=created_at&sort_direction=asc')).body.incident_reports.map((i: any) => i.id))
      .toEqual(ids);
    expect((await raw('/v1/incident_reports?sort_field=id')).body.incident_reports.map((i: any) => i.id))
      .toEqual([...ids].reverse());
    expect((await raw('/v1/incident_reports?sort_field=severity')).status).toBe(400); // not a documented incident sort
    expect((await raw('/v1/incident_reports?sort_direction=sideways')).status).toBe(400);
  });

  it('clamps limit to 1–500 (default 10) and walks page_token to next_page_token: null', async () => {
    await huntress.seed('organization', { name: 'Site', count: 25 });

    const defaulted = await raw('/v1/organizations');
    expect(defaulted.body.organizations).toHaveLength(10); // documented default
    expect(defaulted.body.pagination.next_page_token).toEqual(expect.any(String));
    expect(defaulted.body.pagination.next_page_url).toContain('page_token=');
    expect(defaulted.body.pagination.next_page_url).toContain('limit=10');

    expect((await raw('/v1/organizations?limit=0')).body.organizations).toHaveLength(1);
    expect((await raw('/v1/organizations?limit=501')).body.organizations).toHaveLength(25);
    expect((await raw('/v1/organizations?limit=abc')).body.organizations).toHaveLength(10);

    const walk = await listAll('/v1/organizations', 'organizations', 10);
    expect(walk.items).toHaveLength(25);
    expect(new Set(walk.items.map((o) => o.id)).size).toBe(25);
    expect(walk.tokens).toHaveLength(3);
    expect(walk.tokens[2]).toBeNull();
    // Last page: a token but no URL, per "Only displays when another page can be accessed".
    const last = await raw(`/v1/organizations?limit=10&page_token=${encodeURIComponent(walk.tokens[1] as string)}`);
    expect(last.body.pagination).toEqual({ next_page_token: null });

    const sorted = await listAll('/v1/organizations?sort_field=name&sort_direction=asc', 'organizations', 7);
    expect(sorted.items.map((o) => o.name)).toEqual([...walk.items.map((o) => o.name)].sort());
    expect((await raw('/v1/organizations?page_token=not-a-cursor')).status).toBe(400);
  });

  it('answers armed rate limits with 429 + Retry-After and operation faults with the error envelope', async () => {
    await huntress.seed('organization', { name: 'Acme Inc.' });

    await huntress.arm('rate-limit', { remaining: 2, retryAfterSeconds: 7 });
    const limited = await raw('/v1/incident_reports');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('7');
    expect(limited.body).toEqual({ error: 'Too Many Requests' });
    expect((await raw('/v1/organizations')).status).toBe(429);
    expect((await raw('/v1/organizations')).status).toBe(200);

    await huntress.arm('operation-fault', {
      operation: 'GET /v1/incident_reports',
      status: 503,
      message: 'Service Unavailable',
    });
    const failed = await raw('/v1/incident_reports');
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ error: 'Service Unavailable' });
    expect((await raw('/v1/incident_reports')).body.incident_reports).toEqual([]);

    // A trailing * matches by prefix, which is how by-id routes are targeted.
    const org = (await huntress.seed('organization', { name: 'Globex' })).organizations[0];
    await huntress.arm('operation-fault', { operation: 'GET /v1/organizations/*', status: 500, remaining: 1 });
    expect((await raw(`/v1/organizations/${org.id}`)).status).toBe(500);
    expect((await raw(`/v1/organizations/${org.id}`)).status).toBe(200);
    expect((await raw('/v1/organizations')).status).toBe(200);
  });

  it('answers 400 for an unexpected id, 501 for unmodeled v1 routes, and forgets everything on reset', async () => {
    expect((await raw('/v1/agents/not-a-number')).status).toBe(400);
    const signals = await raw('/v1/signals');
    expect(signals.status).toBe(501);
    expect(signals.body.code).toBe('EmulatorUnsupportedOperation');

    await huntress.seed('organization', { name: 'Acme Inc.' });
    await huntress.arm('rate-limit', { remaining: 5 });
    await huntress.reset();
    expect((await raw('/v1/organizations')).body).toEqual({
      organizations: [],
      pagination: { next_page_token: null },
    });
    expect(await huntress.state('operation-faults')).toEqual([]);
    expect(await huntress.state('auth-failures')).toEqual([]);
  });
});
