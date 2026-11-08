/**
 * End-to-end: client / contact / client_location webhook events reach the webhook-sink emulator
 * as signed deliveries, driven WITHOUT the app server.
 *
 * Real: dev database writes, the UI-action publishers (packages/clients actions), the REST-service
 * publishers (ClientService / ContactService), publishWorkflowEvent + workflow contract validation,
 * the entity webhook subscribers, WebhookDeliveryQueue, processWebhookDeliveryJob (HTTP + HMAC),
 * and the packages/emulators/webhook-sink emulator as the receiver.
 * Stand-ins: the Redis event bus (in-memory fan-out) and Redis (in-memory zset), and the webhooks
 * table (webhookModel is a fixture keyed by tenant + event type).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';

import { EmulatorHost } from '../../../../packages/emulators/host/src';
import webhookSink from '../../../../packages/emulators/webhook-sink/src/index';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

// ---- in-memory event bus -------------------------------------------------------------------
const bus = vi.hoisted(() => {
  const handlers = new Map<string, Set<(e: unknown) => Promise<void>>>();
  return {
    handlers,
    instance: {
      subscribe: async (type: string, handler: any) => {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type)!.add(handler);
      },
      unsubscribe: async (type: string, handler: any) => {
        handlers.get(type)?.delete(handler);
      },
      publish: async (event: { eventType: string; payload: Record<string, unknown> }, opts?: { eventId?: string; channel?: string }) => {
        if (opts?.channel) return;
        const wrapped = {
          id: opts?.eventId ?? globalThis.crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          eventType: event.eventType,
          payload: event.payload,
        };
        for (const h of handlers.get(event.eventType) ?? []) await h(wrapped);
      },
    },
  };
});
vi.mock('@/lib/webhooks/deliveryReceipt', () => ({ withWebhookDeliveryReceipt: async (_db: unknown, _job: unknown, deliver: () => Promise<unknown>) => deliver() }));
vi.mock('@alga-psa/event-bus', async (orig) => ({ ...(await orig<any>()), getEventBus: () => bus.instance }));
vi.mock('@/lib/eventBus', () => ({ getEventBus: () => bus.instance }));

// ---- webhook fixture (webhookModel) ---------------------------------------------------------
const SECRET = 'e2e-signing-secret';
const model = vi.hoisted(() => ({
  subs: [] as any[],
  deliveries: [] as any[],
}));
vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: {
    listForEventType: async (tenant: string, eventType: string) =>
      model.subs.filter((s) => s.tenant === tenant && s.eventTypes.includes(eventType)),
    getById: async (id: string) => model.subs.find((s) => s.webhookId === id) ?? null,
    getSigningSecret: async () => SECRET,
    recordDelivery: async (d: any) => {
      model.deliveries.push(d);
    },
    updateStats: async () => null,
  },
}));
vi.mock('@/lib/webhooks/autoDisable', () => ({ maybeAutoDisable: vi.fn(async () => undefined) }));

// ---- db / auth seams for the UI actions ------------------------------------------------------
const db = vi.hoisted(() => ({ knex: null as any, tenant: '' }));
vi.mock('@alga-psa/db', async (orig) => ({
  ...(await orig<any>()),
  createTenantKnex: async () => ({ knex: db.knex, tenant: db.tenant }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@alga-psa/formatting/avatarUtils', async (orig) => ({
  ...(await orig<any>()),
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import { getCurrentUser } from '@alga-psa/auth';
import { runWithTenant } from '@alga-psa/db';
import { WebhookDeliveryQueue } from '@/lib/webhooks/WebhookDeliveryQueue';
import { processWebhookDeliveryJob } from '@/lib/webhooks/processWebhookDeliveryJob';
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from '@/lib/webhooks/sign';
import { ENTITY_WEBHOOK_SUBSCRIBERS } from '@/lib/eventBus/subscribers/entityWebhookSubscribers';
import { WEBHOOK_EVENT_REGISTRY } from '@/lib/webhooks/eventRegistry';

import {
  createClientLocation,
  deleteClientLocation,
  updateClientLocation,
} from '../../../../packages/clients/src/actions/clientLocationActions';

import { addContact, createClientContact, deleteContact, updateContact, updateContactsForClient } from '../../../../packages/clients/src/actions/contact-actions/contactActions';
import {
  createClient as createClientAction,
  deleteClient as deleteClientAction,
  deactivateClientContacts,
  updateClient as updateClientAction,
} from '../../../../packages/clients/src/actions/clientActions';
import { mergeClientIntoParent } from '../../../../packages/clients/src/actions/clientMergeActions';
import { ClientService } from '../../lib/api/services/ClientService';
import { ContactService } from '../../lib/api/services/ContactService';

function createMockRedis() {
  const kv = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const z = (k: string) => {
    let m = zsets.get(k);
    if (!m) zsets.set(k, (m = new Map()));
    return m;
  };
  return {
    async get(k: string) { return kv.get(k) ?? null; },
    async set(k: string, v: string) { kv.set(k, v); return 'OK'; },
    async del(k: string | string[]) { let n = 0; for (const x of Array.isArray(k) ? k : [k]) if (kv.delete(x)) n++; return n; },
    async zAdd(k: string, i: { value: string; score: number }) { const m = z(k); const isNew = !m.has(i.value); m.set(i.value, i.score); return isNew ? 1 : 0; },
    async zRem(k: string, member: string) { return z(k).delete(member) ? 1 : 0; },
    async zRangeByScore(k: string, min: number, max: number, o?: any) {
      const all = [...z(k).entries()].filter(([, s]) => s >= min && s <= max).sort(([, a], [, b]) => a - b).map(([m]) => m);
      const off = o?.LIMIT?.offset ?? 0;
      return all.slice(off, off + (o?.LIMIT?.count ?? all.length));
    },
    async zCard(k: string) { return z(k).size; },
  } as any;
}

describe('entity webhooks → signed delivery at the webhook-sink (no app server)', () => {
  let knex: Knex;
  let host: EmulatorHost;
  let sinkUrl: string;
  let controlUrl: string;
  let tenant: string;
  let userId: string;
  let clientId: string;
  const created: { contacts: string[]; clients: string[] } = { contacts: [], clients: [] };
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

  const sinkRequests = async (): Promise<any[]> =>
    ((await (await fetch(`${controlUrl}/control/webhook-sink/state/requests`)).json()) as any).result;

  /** Drain the queue, then return the deliveries the sink recorded since the last call. */
  async function drain(): Promise<any[]> {
    const queue = WebhookDeliveryQueue.getInstance();
    await queue.process();
    // allow in-flight deliveries to finish
    for (let i = 0; i < 50; i += 1) {
      const reqs = await sinkRequests();
      if (reqs.length > 0 || i === 49) {
        await new Promise((r) => setTimeout(r, 50));
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const reqs = await sinkRequests();
    await fetch(`${controlUrl}/control/webhook-sink/actions/clear`, { method: 'POST' });
    return reqs;
  }

  function expectSigned(req: any) {
    const sig = req.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()];
    expect(typeof sig).toBe('string');
    // the sink re-serialises JSON; the signature covers the raw bytes Alga sent, which are the
    // canonical JSON.stringify of the envelope Alga built (same key order the sink parsed).
    expect(verifyWebhookSignature(sig, JSON.stringify(req.body), SECRET)).toBe(true);
  }

  beforeAll(async () => {
    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';
    knex = await createTestDbConnection({ runSeeds: true });
    host = new EmulatorHost({ emulators: [webhookSink], controlPort: 0, ports: { 'webhook-sink': 0 } });
    const { controlPort, ports } = await host.start();
    sinkUrl = `http://127.0.0.1:${ports['webhook-sink']}/hooks/alga`;
    controlUrl = `http://127.0.0.1:${controlPort}`;

    const t = await knex('tenants').select('tenant').first();
    tenant = t!.tenant;
    const u = await knex('users').where({ tenant }).select('user_id').first();
    userId = u!.user_id;
    db.knex = knex;
    db.tenant = tenant;
  });

  afterAll(async () => {
    await host?.stop();
    await knex?.destroy();
    if (originalAllowPrivate === undefined) delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    else process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
  });

  beforeEach(async () => {
    bus.handlers.clear();
    model.deliveries.length = 0;
    TokenBucketRateLimiter.resetInstance();
    WebhookDeliveryQueue.resetInstance();
    const redis = createMockRedis();
    await TokenBucketRateLimiter.getInstance().initialize(async () => redis, {
      'webhook-out': async () => ({ maxTokens: 1000, refillRate: 1000 / 60 }),
    });
    await WebhookDeliveryQueue.getInstance({ checkIntervalMs: 999_999 }).initialize(async () => redis, processWebhookDeliveryJob);

    for (const s of ENTITY_WEBHOOK_SUBSCRIBERS) await s.register();

    model.subs = [
      {
        tenant,
        webhookId: 'wh-all',
        url: sinkUrl,
        method: 'POST',
        eventTypes: WEBHOOK_EVENT_REGISTRY.filter((e) => ['client', 'contact', 'client_location'].includes(e.entity)).map((e) => e.name),
        customHeaders: null,
        verifySsl: false,
        isActive: true,
        rateLimitPerMin: 1000,
        eventFilter: null,
        payloadFields: null,
      },
    ];
    await fetch(`${controlUrl}/control/webhook-sink/actions/clear`, { method: 'POST' });

    vi.mocked(getCurrentUser).mockResolvedValue({
      user_id: userId,
      tenant,
      user_type: 'internal',
      roles: [],
    } as any);

    clientId = uuidv4();
    await knex('clients').insert({
      tenant,
      client_id: clientId,
      client_name: `Webhook e2e ${clientId.slice(0, 8)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
    created.clients.push(clientId);
  });

  afterEach(async () => {
    for (const s of ENTITY_WEBHOOK_SUBSCRIBERS) await s.unregister();
    await WebhookDeliveryQueue.getInstance().shutdown();
    WebhookDeliveryQueue.resetInstance();
    TokenBucketRateLimiter.resetInstance();
  });

  describe('UI-action publisher: client_location', () => {
    it('created / updated / deactivated / deleted each reach the sink signed', async () => {
      const loc: any = await createClientLocation(clientId, {
        client_id: clientId,
        location_name: 'HQ',
        address_line1: '1 Main St',
        city: 'Testville',
        country_code: 'US',
        country_name: 'United States',
        is_active: true,
        is_default: true,
      } as any);
      expect(loc.location_id).toBeTruthy();
      let reqs = await drain();
      expect(reqs.map((r) => r.body.event_type)).toEqual(['client_location.created']);
      expect(reqs[0].body).toMatchObject({
        event_type: 'client_location.created',
        tenant_id: tenant,
        data: { location_id: loc.location_id, client_id: clientId },
      });
      expectSigned(reqs[0]);

      await updateClientLocation(loc.location_id, { city: 'Elsewhere' } as any);
      reqs = await drain();
      expect(reqs.map((r) => r.body.event_type)).toEqual(['client_location.updated']);
      expect(reqs[0].body.data).toEqual({ location_id: loc.location_id, client_id: clientId, changed_fields: ['city'] });
      expectSigned(reqs[0]);

      await createClientLocation(clientId, {
        client_id: clientId, location_name: 'Branch', address_line1: '2 Side St', city: 'Testville',
        country_code: 'US', country_name: 'United States', is_active: true, is_default: false,
      } as any).then(async (branch: any) => {
        await drain();
        await updateClientLocation(branch.location_id, { is_active: false } as any);
        reqs = await drain();
        expect(reqs.map((r) => r.body.event_type).sort()).toEqual(['client_location.deactivated', 'client_location.updated']);
        reqs.forEach(expectSigned);

        await deleteClientLocation(branch.location_id);
        reqs = await drain();
        expect(reqs.map((r) => r.body.event_type)).toEqual(['client_location.deleted']);
        expect(reqs[0].body.data).toEqual({ location_id: branch.location_id, client_id: clientId });
        expectSigned(reqs[0]);
      });
    });
  });

  const names = (reqs: any[]) => reqs.map((r) => r.body.event_type).sort();
  const locationInput = (name: string, extra: Record<string, unknown> = {}) => ({
    client_id: clientId, location_name: name, address_line1: `${name} St`, city: 'Testville',
    country_code: 'US', country_name: 'United States', is_active: true, is_default: false, ...extra,
  });

  describe('UI-action publisher: contact and client', () => {
    it('contact created / updated / deactivated / deleted', async () => {
      const added: any = await addContact({ full_name: 'Ui Contact', email: `ui-${uuidv4()}@example.com`, client_id: clientId } as any);
      expect(added.success, JSON.stringify(added)).toBe(true);
      const contactId = added.contact.contact_name_id;
      expect(contactId).toBeTruthy();
      let reqs = await drain();
      expect(names(reqs)).toEqual(['contact.created']);
      expect(reqs[0].body.data).toEqual({ contact_id: contactId, client_id: clientId });
      expectSigned(reqs[0]);

      await updateContact({ contact_name_id: contactId, full_name: 'Ui Contact Renamed' } as any);
      reqs = await drain();
      expect(names(reqs)).toEqual(['contact.updated']);
      expect(reqs[0].body.data).toMatchObject({ contact_id: contactId, client_id: clientId });
      expect(reqs[0].body.data.changed_fields).toContain('full_name');
      expectSigned(reqs[0]);

      await updateContact({ contact_name_id: contactId, is_inactive: true } as any);
      reqs = await drain();
      expect(names(reqs)).toContain('contact.deactivated');
      reqs.forEach(expectSigned);

      const del: any = await runWithTenant(tenant, () => deleteContact(contactId));
      expect(del.success).toBe(true);
      reqs = await drain();
      expect(names(reqs)).toEqual(['contact.deleted']);
      expect(reqs[0].body.data).toMatchObject({ contact_id: contactId });
      expectSigned(reqs[0]);
    });

    it('client-less contact still emits contact.created without client_id', async () => {
      const added: any = await addContact({ full_name: 'No Client', email: `nc-${uuidv4()}@example.com` } as any);
      const reqs = await drain();
      expect(names(reqs)).toEqual(['contact.created']);
      expect(added.success, JSON.stringify(added)).toBe(true);
      expect(reqs[0].body.data).toEqual({ contact_id: added.contact.contact_name_id });
      expectSigned(reqs[0]);
    });

    it('client created / updated / deactivated / deleted', async () => {
      const result: any = await createClientAction({
        client_name: `Ui Client ${uuidv4().slice(0, 8)}`, client_type: 'company', is_inactive: false,
        url: '', billing_cycle: 'monthly', is_tax_exempt: false, properties: {},
      } as any);
      expect(result.success).toBe(true);
      const id = result.data.client_id;
      created.clients.push(id);
      let reqs = await drain();
      expect(names(reqs)).toEqual(['client.created']);
      expect(reqs[0].body.data).toEqual({ client_id: id });
      expectSigned(reqs[0]);

      await updateClientAction(id, { client_name: `Renamed ${uuidv4().slice(0, 8)}` } as any);
      reqs = await drain();
      expect(names(reqs)).toEqual(['client.updated']);
      expect(reqs[0].body.data.client_id).toBe(id);
      expect(reqs[0].body.data.changed_fields).toContain('client_name');
      expectSigned(reqs[0]);

      await updateClientAction(id, { is_inactive: true } as any);
      reqs = await drain();
      expect(names(reqs)).toContain('client.deactivated');
      reqs.forEach(expectSigned);

      const del: any = await runWithTenant(tenant, () => deleteClientAction(id));
      expect(del.success).toBe(true);
      reqs = await drain();
      expect(names(reqs)).toEqual(['client.deleted']);
      expect(reqs[0].body.data).toEqual({ client_id: id });
      expectSigned(reqs[0]);
    });
  });

  describe('REST-service publisher: client, contact and client_location', () => {
    let ctx: { tenant: string; userId: string };
    let clientService: ClientService;
    let contactService: ContactService;

    // ClientService.update's is_inactive cascade (contact:update) and the delete paths check RBAC
    // against the DB. Use a dedicated user whose only role is created here, so the test does not
    // depend on whatever roles the seeded user happens to hold in a given environment.
    let restUserId: string;
    let restRoleId: string;

    beforeAll(async () => {
      const seeded = await knex('users').where({ tenant, user_id: userId }).first();
      restUserId = uuidv4();
      await knex('users').insert({
        ...seeded,
        user_id: restUserId,
        username: `rest-e2e-${restUserId.slice(0, 8)}`,
        email: `rest-e2e-${restUserId.slice(0, 8)}@example.test`,
      });
      restRoleId = uuidv4();
      await knex('roles').insert({
        tenant,
        role_id: restRoleId,
        role_name: `Webhook REST e2e ${restRoleId.slice(0, 8)}`,
        description: 'entityWebhooks.sinkE2E REST publisher role',
        msp: true,
        client: false,
      });
      await knex('user_roles').insert({ tenant, user_id: restUserId, role_id: restRoleId });
      const grants = ['client', 'contact'].flatMap((resource) =>
        ['create', 'read', 'update', 'delete'].map((action) => ({
          tenant,
          permission_id: uuidv4(),
          resource,
          action,
          msp: true,
          client: false,
        })),
      );
      await knex('permissions').insert(grants);
      await knex('role_permissions').insert(
        grants.map((g) => ({ tenant, role_id: restRoleId, permission_id: g.permission_id })),
      );
    });

    afterAll(async () => {
      const permissionIds = (await knex('role_permissions').where({ tenant, role_id: restRoleId }).select('permission_id')).map(
        (r: any) => r.permission_id,
      );
      await knex('role_permissions').where({ tenant, role_id: restRoleId }).del();
      await knex('permissions').where({ tenant }).whereIn('permission_id', permissionIds).del();
      await knex('user_roles').where({ tenant, role_id: restRoleId }).del();
      await knex('roles').where({ tenant, role_id: restRoleId }).del();
      await knex('users').where({ tenant, user_id: restUserId }).del();
    });

    beforeEach(() => {
      ctx = { tenant, userId: restUserId, user: { user_id: restUserId, tenant, user_type: 'internal', roles: [] } } as any;
      clientService = new ClientService();
      contactService = new ContactService();
      vi.spyOn(clientService as any, 'getKnex').mockResolvedValue({ knex, tenant });
      vi.spyOn(contactService as any, 'getKnex').mockResolvedValue({ knex, tenant });
    });

    it('client created / updated / deactivated / deleted', async () => {
      const client: any = await clientService.createClient(
        { client_name: `Rest Client ${uuidv4().slice(0, 8)}`, billing_cycle: 'monthly', is_tax_exempt: false } as any,
        ctx as any,
      );
      const id = client.client_id;
      created.clients.push(id);
      let reqs = await drain();
      expect(names(reqs)).toEqual(['client.created']);
      expect(reqs[0].body.data).toEqual({ client_id: id });
      expectSigned(reqs[0]);

      await clientService.update(id, { client_name: `Rest Renamed ${uuidv4().slice(0, 8)}` } as any, ctx as any);
      reqs = await drain();
      expect(names(reqs)).toEqual(['client.updated']);
      expect(reqs[0].body.data.changed_fields).toContain('client_name');
      expectSigned(reqs[0]);

      await clientService.update(id, { is_inactive: true } as any, ctx as any);
      reqs = await drain();
      expect(names(reqs)).toContain('client.deactivated');
      reqs.forEach(expectSigned);

      await clientService.delete(id, ctx as any);
      reqs = await drain();
      expect(names(reqs)).toEqual(['client.deleted']);
      expect(reqs[0].body.data).toEqual({ client_id: id });
      expectSigned(reqs[0]);
    });

    it('contact created / updated / deactivated / deleted', async () => {
      const contact: any = await contactService.create(
        { full_name: 'Rest Contact', email: `rest-${uuidv4()}@example.com`, client_id: clientId } as any,
        ctx as any,
      );
      const id = contact.contact_name_id;
      let reqs = await drain();
      expect(names(reqs)).toEqual(['contact.created']);
      expect(reqs[0].body.data).toEqual({ contact_id: id, client_id: clientId });
      expectSigned(reqs[0]);

      await contactService.update(id, { full_name: 'Rest Contact 2' } as any, ctx as any);
      reqs = await drain();
      expect(names(reqs)).toEqual(['contact.updated']);
      expect(reqs[0].body.data.changed_fields).toContain('full_name');
      expectSigned(reqs[0]);

      await contactService.update(id, { is_inactive: true } as any, ctx as any);
      reqs = await drain();
      expect(names(reqs)).toContain('contact.deactivated');
      reqs.forEach(expectSigned);

      await contactService.delete(id, ctx as any);
      reqs = await drain();
      expect(names(reqs)).toEqual(['contact.deleted']);
      expect(reqs[0].body.data).toMatchObject({ contact_id: id });
      expectSigned(reqs[0]);
    });

    it('client_location created / updated / deactivated / deleted', async () => {
      const loc: any = await clientService.createLocation(clientId, locationInput('Rest HQ', { is_default: true }) as any, ctx as any);
      let reqs = await drain();
      expect(names(reqs)).toEqual(['client_location.created']);
      expect(reqs[0].body.data).toEqual({ location_id: loc.location_id, client_id: clientId });
      expectSigned(reqs[0]);

      await clientService.updateLocation(clientId, loc.location_id, { city: 'Moved' } as any, ctx as any);
      reqs = await drain();
      expect(names(reqs)).toEqual(['client_location.updated']);
      expect(reqs[0].body.data.changed_fields).toEqual(['city']);
      expectSigned(reqs[0]);

      const branch: any = await clientService.createLocation(clientId, locationInput('Rest Branch') as any, ctx as any);
      await drain();
      await clientService.updateLocation(clientId, branch.location_id, { is_active: false } as any, ctx as any);
      reqs = await drain();
      expect(names(reqs)).toEqual(['client_location.deactivated', 'client_location.updated']);
      reqs.forEach(expectSigned);

      await clientService.deleteLocation(clientId, branch.location_id, ctx as any);
      reqs = await drain();
      expect(names(reqs)).toEqual(['client_location.deleted']);
      expectSigned(reqs[0]);
    });
  });

  describe('secondary writers: after-commit contact and location events', () => {
    it('createClientContact publishes contact.created after commit', async () => {
      const contact: any = await createClientContact({
        clientId, fullName: 'Quick Add', email: `qa-${uuidv4()}@example.com`,
      } as any);
      const reqs = await drain();
      expect(names(reqs)).toEqual(['contact.created']);
      expect(reqs[0].body.data).toEqual({ contact_id: contact.contact_name_id, client_id: clientId });
      expectSigned(reqs[0]);
    });

    it('bulk move (updateContactsForClient) publishes contact.updated with client_id in changed_fields', async () => {
      const a: any = await addContact({ full_name: 'Bulk A', email: `ba-${uuidv4()}@example.com`, client_id: clientId } as any);
      const b: any = await addContact({ full_name: 'Bulk B', email: `bb-${uuidv4()}@example.com`, client_id: clientId } as any);
      await drain();
      const otherClient = uuidv4();
      await knex('clients').insert({
        tenant, client_id: otherClient, client_name: `Bulk target ${otherClient.slice(0, 8)}`,
        billing_cycle: 'monthly', is_tax_exempt: false, created_at: knex.fn.now(), updated_at: knex.fn.now(),
      });
      created.clients.push(otherClient);

      await updateContactsForClient(clientId, { client_id: otherClient } as any);
      const reqs = await drain();
      expect(names(reqs)).toEqual(['contact.updated', 'contact.updated']);
      expect(reqs.map((r) => r.body.data.contact_id).sort()).toEqual(
        [a.contact.contact_name_id, b.contact.contact_name_id].sort(),
      );
      for (const r of reqs) {
        expect(r.body.data.client_id).toBe(otherClient);
        expect(r.body.data.changed_fields).toContain('client_id');
        expectSigned(r);
      }
    });

    it('cascade deactivation publishes contact.deactivated per contact', async () => {
      const a: any = await addContact({ full_name: 'Casc A', email: `ca-${uuidv4()}@example.com`, client_id: clientId } as any);
      const b: any = await addContact({ full_name: 'Casc B', email: `cb-${uuidv4()}@example.com`, client_id: clientId } as any);
      await drain();
      const result: any = await deactivateClientContacts(clientId);
      expect(result.success).toBe(true);
      const reqs = await drain();
      const deactivated = reqs.filter((r) => r.body.event_type === 'contact.deactivated');
      expect(deactivated.map((r) => r.body.data.contact_id).sort()).toEqual(
        [a.contact.contact_name_id, b.contact.contact_name_id].sort(),
      );
      reqs.forEach(expectSigned);
    });

    it('deleting the default location promotes the next one and publishes client_location.updated', async () => {
      const hq: any = await createClientLocation(clientId, locationInput('Promo HQ', { is_default: true }) as any);
      const branch: any = await createClientLocation(clientId, locationInput('Promo Branch') as any);
      await drain();
      await deleteClientLocation(hq.location_id);
      const reqs = await drain();
      expect(names(reqs)).toEqual(['client_location.deleted', 'client_location.updated']);
      const updated = reqs.find((r) => r.body.event_type === 'client_location.updated')!;
      expect(updated.body.data.location_id).toBe(branch.location_id);
      expect(updated.body.data.changed_fields).toContain('is_default');
      reqs.forEach(expectSigned);
    });

    it('making another location default demotes the previous default with client_location.updated', async () => {
      const hq: any = await createClientLocation(clientId, locationInput('Demote HQ', { is_default: true }) as any);
      const branch: any = await createClientLocation(clientId, locationInput('Demote Branch') as any);
      await drain();
      await updateClientLocation(branch.location_id, { is_default: true } as any);
      const reqs = await drain();
      expect(names(reqs)).toEqual(['client_location.updated', 'client_location.updated']);
      expect(reqs.map((r) => r.body.data.location_id).sort()).toEqual([hq.location_id, branch.location_id].sort());
      for (const r of reqs) expect(r.body.data.changed_fields).toContain('is_default');
    });

    it('client merge re-parents contacts and locations with client_id in changed_fields', async () => {
      const target = uuidv4();
      await knex('clients').insert({
        tenant, client_id: target, client_name: `Merge target ${target.slice(0, 8)}`,
        billing_cycle: 'monthly', is_tax_exempt: false, created_at: knex.fn.now(), updated_at: knex.fn.now(),
      });
      created.clients.push(target);
      const c: any = await addContact({ full_name: 'Merge C', email: `mc-${uuidv4()}@example.com`, client_id: clientId } as any);
      const loc: any = await createClientLocation(clientId, locationInput('Merge Loc') as any);
      await drain();

      const result: any = await mergeClientIntoParent({ sourceClientId: clientId, targetClientId: target } as any);
      expect(result.error, JSON.stringify(result)).toBeUndefined();
      const reqs = await drain();
      const contactEv = reqs.find((r) => r.body.event_type === 'contact.updated' && r.body.data.contact_id === c.contact.contact_name_id);
      const locEv = reqs.find((r) => r.body.event_type === 'client_location.updated' && r.body.data.location_id === loc.location_id);
      expect(contactEv?.body.data).toMatchObject({ client_id: target, changed_fields: ['client_id'] });
      expect(locEv?.body.data.client_id).toBe(target);
      expect(locEv?.body.data.changed_fields).toContain('client_id');
      expect(names(reqs)).toContain('client.deleted');
      reqs.forEach(expectSigned);
    });
  });

  describe('delivery filters and retired names', () => {
    it('entity_ids matches the parent client id for contact events, and skips other clients', async () => {
      model.subs = [
        { ...model.subs[0], webhookId: 'wh-parent', eventFilter: { entity_ids: [clientId] }, eventTypes: ['contact.created'] },
        { ...model.subs[0], webhookId: 'wh-other', eventFilter: { entity_ids: [uuidv4()] }, eventTypes: ['contact.created'] },
        // a subscription holding only a retired name never fires and never errors
        { ...model.subs[0], webhookId: 'wh-legacy', eventTypes: ['invoice.created'] },
      ];
      await addContact({ full_name: 'Filtered', email: `f-${uuidv4()}@example.com`, client_id: clientId } as any);
      const reqs = await drain();
      expect(reqs).toHaveLength(1);
      expect(reqs[0].body.event_type).toBe('contact.created');
      expect(model.deliveries.map((d) => d.webhookId)).toEqual(['wh-parent']);
    });
  });
});
