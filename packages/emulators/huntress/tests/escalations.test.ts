import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { basicAuth, startHuntress } from './helpers';

// The Escalations surface: the list serves `Escalation`, the by-id endpoint
// serves `EscalationWithEntities`, and POST /resolution documents 201/400/403/
// 409/422. Alga's escalation ingestion (PR #3814) is covered on the product
// side once it lands; this file is the vendor contract.

const CREDENTIAL_ERROR = 'There was an issue with your API credential or permissions.';
let huntress: Awaited<ReturnType<typeof startHuntress>>;

async function raw(path: string, init: RequestInit = {}) {
  const response = await fetch(`${huntress.vendor}${path}`, {
    ...init,
    headers: { authorization: basicAuth(), ...(init.headers as Record<string, string>) },
  });
  return { status: response.status, headers: response.headers, body: (await response.json()) as any };
}

function resolution(id: number, body: Record<string, unknown> = {}, auth?: string) {
  return raw(`/v1/escalations/${id}/resolution`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
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

describe('Huntress v1 escalations', () => {
  it('lists escalations without entities and serves them with entities by id', async () => {
    const acme = (await huntress.seed('organization', { name: 'Acme Inc.' })).organizations[0];
    const globex = (await huntress.seed('organization', { name: 'Globex' })).organizations[0];
    const laptop = (await huntress.seed('agent', {
      hostname: 'laptop01',
      organization_id: acme.id,
      platform: 'windows',
      os: 'Windows 8 Pro',
    })).agent;
    const escalation = (await huntress.seed('escalation', {
      organization_ids: [acme.id, globex.id],
      severity: 'high',
      subject: 'Unexpected login from an unexpected country',
      type: 'Unexpected Country Access',
      type_code: 'unexpected_country_access',
      subtype: 'RU',
      psa_ticket_eids: ['T-1696'],
      entities: [
        { id: laptop.id, type: 'Agent' },
        { id: 9001, type: 'Identity', details: { username: 'user@example.com', email: 'user@example.com' } },
      ],
    })).escalation;

    const list = await raw('/v1/escalations');
    expect(list.body.escalations).toHaveLength(1);
    expect(list.body.escalations[0]).toEqual({
      id: escalation.id,
      account: { id: 1, name: 'Algasim Partner Account' },
      organizations: [
        { id: acme.id, name: 'Acme Inc.' },
        { id: globex.id, name: 'Globex' },
      ],
      created_at: expect.any(String),
      resolved_at: null,
      severity: 'high',
      status: 'open',
      subject: 'Unexpected login from an unexpected country',
      subtype: 'RU',
      type: 'Unexpected Country Access',
      type_code: 'unexpected_country_access',
      psa_ticket_eids: ['T-1696'],
      updated_at: expect.any(String),
    });
    // The list schema is Escalation: no entities.
    expect(list.body.escalations[0].entities).toBeUndefined();
    expect(list.body.pagination).toEqual({ next_page_token: null });

    const detail = await raw(`/v1/escalations/${escalation.id}`);
    expect(detail.body.escalation.entities).toEqual({
      total_count: 2,
      has_more: false,
      items: [
        {
          id: laptop.id,
          type: 'Agent',
          // Agent entity details mirror the agent record, as the schema example shows.
          details: {
            hostname: 'laptop01',
            platform: 'windows',
            os: 'Windows 8 Pro',
            last_callback_at: expect.any(String),
          },
        },
        { id: 9001, type: 'Identity', details: { username: 'user@example.com', email: 'user@example.com' } },
      ],
    });

    const missing = await raw('/v1/escalations/4242');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Not Found' });
  });

  it('serves escalations with zero or many organizations and reflects a dropped organization', async () => {
    const acme = (await huntress.seed('organization', { name: 'Acme Inc.' })).organizations[0];
    const globex = (await huntress.seed('organization', { name: 'Globex' })).organizations[0];
    const accountWide = (await huntress.seed('escalation', { subject: 'Account-wide notice' })).escalation;
    const both = (await huntress.seed('escalation', { organization_ids: [acme.id, globex.id] })).escalation;

    expect((await raw(`/v1/escalations/${accountWide.id}`)).body.escalation.organizations).toEqual([]);
    expect((await raw(`/v1/escalations?organization_id=${acme.id}`)).body.escalations.map((e: any) => e.id)).toEqual([both.id]);

    huntress.host.clock.advance('15m');
    await huntress.action('update-escalation', { escalationId: both.id, removeOrganizationIds: [globex.id] });
    const narrowed = (await raw(`/v1/escalations/${both.id}`)).body.escalation;
    expect(narrowed.organizations).toEqual([{ id: acme.id, name: 'Acme Inc.' }]);
    expect(Date.parse(narrowed.updated_at)).toBeGreaterThan(Date.parse(both.updated_at));
    expect((await raw(`/v1/escalations?organization_id=${globex.id}`)).body.escalations).toEqual([]);

    // An organization deleted in Huntress keeps its id on the escalation.
    await huntress.action('update-escalation', { escalationId: both.id, addOrganizationIds: [globex.id] });
    await huntress.action('delete-organization', { organizationId: globex.id });
    expect((await raw(`/v1/escalations/${both.id}`)).body.escalation.organizations).toEqual([
      { id: acme.id, name: 'Acme Inc.' },
      { id: globex.id, name: `Huntress org ${globex.id}` },
    ]);
    expect((await raw(`/v1/organizations/${globex.id}`)).status).toBe(404);
  });

  it('filters and sorts escalations by the documented fields', async () => {
    const acme = (await huntress.seed('organization', { name: 'Acme Inc.' })).organizations[0];
    const low = (await huntress.seed('escalation', {
      organization_ids: [acme.id],
      severity: 'low',
      subtype: 'US',
      due_at: '2026-10-21T00:00:00Z',
    })).escalation;
    const critical = (await huntress.seed('escalation', {
      organization_ids: [acme.id],
      severity: 'critical',
      status: 'overdue',
      subtype: 'RU',
      due_at: '2026-10-20T00:00:00Z',
      psa_ticket_eids: ['T-42'],
    })).escalation;

    expect((await raw('/v1/escalations?status=overdue')).body.escalations.map((e: any) => e.id)).toEqual([critical.id]);
    expect((await raw('/v1/escalations?status=open')).body.escalations.map((e: any) => e.id)).toEqual([low.id]);
    expect((await raw('/v1/escalations?severity=critical')).body.escalations.map((e: any) => e.id)).toEqual([critical.id]);
    expect((await raw('/v1/escalations?subtype=US')).body.escalations.map((e: any) => e.id)).toEqual([low.id]);
    expect((await raw('/v1/escalations?psa_ticket_eid=T-42')).body.escalations.map((e: any) => e.id)).toEqual([critical.id]);
    expect((await raw('/v1/escalations?status=sent')).status).toBe(400); // mirrored-spec value, not a live one

    // severity sorts low < high < critical; due_at is a documented sort_field
    // with no schema field of its own.
    expect((await raw('/v1/escalations?sort_field=severity&sort_direction=asc')).body.escalations.map((e: any) => e.id))
      .toEqual([low.id, critical.id]);
    expect((await raw('/v1/escalations?sort_field=due_at&sort_direction=asc')).body.escalations.map((e: any) => e.id))
      .toEqual([critical.id, low.id]);
    expect((await raw('/v1/escalations?sort_field=due_at')).body.escalations[0].due_at).toBeUndefined();

    huntress.host.clock.advance('1h');
    await huntress.action('update-escalation', { escalationId: low.id, status: 'overdue' });
    expect((await raw('/v1/escalations?sort_field=updated_at&sort_direction=desc')).body.escalations.map((e: any) => e.id))
      .toEqual([low.id, critical.id]);
  });

  it('resolves an escalation directly, and answers 409 on a second attempt', async () => {
    const escalation = (await huntress.seed('escalation', {
      subject: 'Defender Disabled',
      type: 'Environmental Issue',
      type_code: 'environmental_issue',
    })).escalation;

    huntress.host.clock.advance('10m');
    const resolved = await resolution(escalation.id);
    expect(resolved.status).toBe(201);
    expect(resolved.body.resolution_method).toBe('direct');
    expect(resolved.body.escalation.status).toBe('resolved');
    expect(resolved.body.escalation.resolved_at).toBe(resolved.body.escalation.updated_at);
    expect(Date.parse(resolved.body.escalation.updated_at)).toBeGreaterThan(Date.parse(escalation.updated_at));
    expect(resolved.body.escalation.entities).toEqual({ total_count: 0, has_more: false, items: [] });

    const again = await resolution(escalation.id);
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: 'Escalation has already been resolved' });

    // determination/scope belong to Unwanted Access escalations only.
    const other = (await huntress.seed('escalation', { type_code: 'environmental_issue' })).escalation;
    const rejected = await resolution(other.id, { determination: 'expected', scope: 'identity' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain('do not accept determination or scope');
    expect((await raw(`/v1/escalations/${other.id}`)).body.escalation.status).toBe('open');
  });

  it('bulk-resolves an Unwanted Access escalation by rule, dismiss, or 400', async () => {
    const acme = (await huntress.seed('organization', { name: 'Acme Inc.' })).organizations[0];
    const seedUnwanted = async () =>
      (await huntress.seed('escalation', {
        organization_ids: [acme.id],
        severity: 'high',
        subject: 'Unwanted country access',
        type: 'Unwanted Country Access',
        type_code: 'unwanted_country_access',
        subtype: 'RU',
        entities: [{ id: 9001, type: 'Identity', details: { email: 'email123@example.com' } }],
      })).escalation;

    const byRule = await resolution((await seedUnwanted()).id, {
      determination: 'unauthorized',
      scope: 'organization',
      revoke_and_disable_identities: true,
    });
    expect(byRule.status).toBe(201);
    expect(byRule.body.resolution_method).toBe('rule');

    // Both parameters omitted is the portal's temporary "dismiss".
    const dismissed = await resolution((await seedUnwanted()).id);
    expect(dismissed.status).toBe(201);
    expect(dismissed.body.resolution_method).toBe('dismiss');

    const target = await seedUnwanted();
    expect((await resolution(target.id, { determination: 'unauthorized' })).status).toBe(400);
    expect((await resolution(target.id, { determination: 'sideways', scope: 'account' })).status).toBe(400);
    expect((await resolution(target.id, { determination: 'expected', scope: 'nowhere' })).status).toBe(400);
    expect((await resolution(target.id, { determination: 'expected', scope: 'identity', revoke_and_disable_identities: true })).status)
      .toBe(400);
    expect((await resolution(target.id, { determination: 'expected', scope: 'identity', ip_address: 'not-an-ip' })).status)
      .toBe(400);
    expect((await raw(`/v1/escalations/${target.id}`)).body.escalation.status).toBe('open');

    const withIp = await resolution(target.id, {
      determination: 'expected',
      scope: 'identity',
      ip_address: '198.51.100.42',
      expiration_date: '2026-12-01T00:00:00Z',
    });
    expect(withIp.status).toBe(201);
    expect(withIp.body.resolution_method).toBe('rule');
  });

  it('answers 403 for a read-only credential and 422 when the type cannot be resolved by API', async () => {
    await huntress.action('configure', {
      credentials: [
        { key: 'algasim-huntress-key', secret: 'algasim-huntress-secret', escalationsWrite: true },
        // "the default account API key is read-only" — writes need a user key.
        { key: 'readonly-key', secret: 'readonly-secret', escalationsWrite: false },
      ],
    });
    const escalation = (await huntress.seed('escalation', { subject: 'Defender Disabled' })).escalation;

    const readOnly = await resolution(escalation.id, {}, basicAuth('readonly-key', 'readonly-secret'));
    expect(readOnly.status).toBe(403);
    expect(readOnly.body).toEqual({ error: CREDENTIAL_ERROR });
    expect((await raw(`/v1/escalations/${escalation.id}`)).body.escalation.status).toBe('open');

    const manual = (await huntress.seed('escalation', { subject: 'Needs a human', api_resolvable: false })).escalation;
    const refused = await resolution(manual.id);
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({ error: 'Escalation cannot be resolved through the API' });

    expect((await resolution(4242)).status).toBe(404);
  });

  it('pages escalations with page_token and fails the whole stream under an operation fault', async () => {
    await huntress.seed('organization', { name: 'Acme Inc.' });
    for (let index = 0; index < 12; index += 1) {
      await huntress.seed('escalation', { subject: `Escalation ${index}` });
    }

    const first = await raw('/v1/escalations?limit=5&sort_field=updated_at&sort_direction=desc');
    expect(first.body.escalations).toHaveLength(5);
    const second = await raw(
      `/v1/escalations?limit=5&sort_field=updated_at&sort_direction=desc&page_token=${encodeURIComponent(first.body.pagination.next_page_token)}`,
    );
    const third = await raw(
      `/v1/escalations?limit=5&sort_field=updated_at&sort_direction=desc&page_token=${encodeURIComponent(second.body.pagination.next_page_token)}`,
    );
    expect(third.body.escalations).toHaveLength(2);
    expect(third.body.pagination).toEqual({ next_page_token: null });
    const walked = [...first.body.escalations, ...second.body.escalations, ...third.body.escalations];
    expect(new Set(walked.map((e: any) => e.id)).size).toBe(12);

    await huntress.arm('operation-fault', { operation: 'GET /v1/escalations', status: 500, remaining: 1 });
    expect((await raw('/v1/escalations')).status).toBe(500);
    // The incident stream is untouched by an escalation-only fault.
    expect((await raw('/v1/incident_reports')).status).toBe(200);
    expect((await raw('/v1/escalations')).status).toBe(200);
  });
});
