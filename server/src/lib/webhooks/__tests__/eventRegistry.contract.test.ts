/**
 * Contract: the webhook event registry is the single source of truth.
 * Registry, every subscriber's internal -> public maps, the REST enum, the
 * OpenAPI enum, the controller listing, the admin listing, the retry-envelope
 * list and the delivery-retry SUPPORTED_WEBHOOK_EVENTS are EXACTLY equal sets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alga-psa/auth/withAuth', () => ({ withAuth: (action: any) => action }));
vi.mock('@alga-psa/auth/actions', () => ({
  getUserRoles: async () => [{ role_name: 'Admin' }],
}));
vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: { listForEventType: vi.fn(), getById: vi.fn() },
}));
vi.mock('@/lib/webhooks/WebhookDeliveryQueue', () => ({
  WebhookDeliveryQueue: { getInstance: () => ({ enqueue: vi.fn() }) },
}));
vi.mock('@/lib/eventBus', () => ({ getEventBus: () => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }) }));
vi.mock('@/lib/db', () => ({
  runWithTenant: async (_t: string, cb: () => Promise<unknown>) => cb(),
}));

import {
  WEBHOOK_EVENT_NAMES,
  WEBHOOK_EVENT_REGISTRY,
  internalToPublicMap,
  type WebhookEntity,
} from '../eventRegistry';
import { SUPPORTED_WEBHOOK_EVENTS, deliveryEnvelopeSchema } from '../deliveryRetry';
import { webhookEventTypeSchema } from '@/lib/api/schemas/webhookSchemas';
import { TICKET_INTERNAL_TO_PUBLIC } from '@/lib/eventBus/subscribers/webhook/webhookEventMap';
import { PROJECT_INTERNAL_TO_PUBLIC } from '@/lib/eventBus/subscribers/webhook/webhookProjectEventMap';
import { ENTITY_WEBHOOK_SUBSCRIBERS } from '@/lib/eventBus/subscribers/entityWebhookSubscribers';
import { listWebhookEvents } from '@/lib/actions/webhookActions';
import { ApiWebhookController } from '@/lib/api/controllers/ApiWebhookController';
import { buildBaseRegistry } from '@/lib/api/openapi';

const sorted = (values: readonly string[]) => [...values].sort();
const registryNames = sorted(WEBHOOK_EVENT_NAMES);

/** Registry-derived (source -> names) for one entity, as sorted pairs, for map equality. */
const pairsOf = (map: Readonly<Record<string, readonly string[]>>) =>
  Object.entries(map)
    .flatMap(([source, names]) => names.map((n) => `${source}>${n}`))
    .sort();

const registryPairs = (entity: WebhookEntity) =>
  WEBHOOK_EVENT_REGISTRY.filter((e) => e.entity === entity)
    .flatMap((e) => e.sourceEvents.map((s) => `${s}>${e.name}`))
    .sort();

describe('webhook event registry contract', () => {
  it('has unique public names whose prefix is the entity allowlist key', () => {
    expect(new Set(WEBHOOK_EVENT_NAMES).size).toBe(WEBHOOK_EVENT_NAMES.length);
    for (const e of WEBHOOK_EVENT_REGISTRY) {
      expect(e.name.startsWith(`${e.entity}.`), e.name).toBe(true);
      expect(e.sourceEvents.length, e.name).toBeGreaterThan(0);
      expect(e.entityIdKeys.length, e.name).toBeGreaterThan(0);
    }
  });

  it('advertises entity lifecycle events alongside ticket and project events', () => {
    const newOnes = registryNames.filter((n) => /^(client|contact|client_location)\./.test(n));
    expect(newOnes).toEqual(
      sorted(
        ['client', 'contact', 'client_location'].flatMap((entity) =>
          ['created', 'updated', 'deactivated', 'deleted'].map((a) => `${entity}.${a}`),
        ),
      ),
    );
    expect(registryNames.filter((n) => n.startsWith('ticket.'))).toHaveLength(7);
    expect(registryNames.filter((n) => n.startsWith('project.'))).toHaveLength(11);
    expect(registryNames.filter((n) => n.startsWith('quote.'))).toEqual(sorted([
      'quote.sent', 'quote.viewed', 'quote.approved', 'quote.accepted', 'quote.rejected',
      'quote.expired', 'quote.converted', 'quote.conversion_reverted', 'quote.superseded', 'quote.cancelled',
    ]));
    expect(registryNames).toHaveLength(40);
  });

  it('no *.archived alias exists', () => {
    expect(registryNames.filter((n) => n.endsWith('.archived'))).toEqual([]);
  });

  it('retired legacy names are not advertised', () => {
    for (const legacy of [
      'time.entry.created', 'invoice.created', 'asset.created', 'system.backup.completed',
      'workflow.execution.started', 'custom.event',
    ]) {
      expect(registryNames).not.toContain(legacy);
    }
  });

  it('ticket and project subscriber maps equal their registry slices (pairs, not just names)', () => {
    expect(pairsOf(TICKET_INTERNAL_TO_PUBLIC)).toEqual(registryPairs('ticket'));
    expect(pairsOf(PROJECT_INTERNAL_TO_PUBLIC)).toEqual(registryPairs('project'));
  });

  it('each entity subscriber derives its map from the registry', () => {
    for (const sub of ENTITY_WEBHOOK_SUBSCRIBERS) {
      expect(pairsOf(sub.internalToPublic), sub.entity).toEqual(registryPairs(sub.entity));
      expect(sorted(sub.internalEvents), sub.entity).toEqual(sorted(Object.keys(internalToPublicMap(sub.entity))));
    }
  });

  it('every subscriber map together emits exactly the registry set', () => {
    const all = [
      ...Object.values(TICKET_INTERNAL_TO_PUBLIC).flat(),
      ...Object.values(PROJECT_INTERNAL_TO_PUBLIC).flat(),
      ...ENTITY_WEBHOOK_SUBSCRIBERS.flatMap((s) => Object.values(s.internalToPublic).flat()),
    ];
    expect(sorted([...new Set(all)])).toEqual(registryNames);
  });

  it('no internal event maps to two public names (known exception: PROJECT_CLOSED)', () => {
    const KNOWN_COLLISIONS = new Set(['PROJECT_CLOSED']);
    const maps: Array<Readonly<Record<string, readonly string[]>>> = [
      TICKET_INTERNAL_TO_PUBLIC,
      PROJECT_INTERNAL_TO_PUBLIC,
      ...ENTITY_WEBHOOK_SUBSCRIBERS.map((s) => s.internalToPublic),
    ];
    const collisions = new Set<string>();
    for (const map of maps) {
      for (const [source, names] of Object.entries(map)) {
        if (names.length > 1) collisions.add(source);
      }
    }
    expect([...collisions].filter((c) => !KNOWN_COLLISIONS.has(c))).toEqual([]);
    expect([...collisions]).toEqual(['PROJECT_CLOSED']);
  });

  it('an internal event is owned by exactly one entity', () => {
    const owner = new Map<string, string>();
    for (const e of WEBHOOK_EVENT_REGISTRY) {
      for (const s of e.sourceEvents) {
        const prev = owner.get(s);
        expect(prev === undefined || prev === e.entity, `${s} owned by ${prev} and ${e.entity}`).toBe(true);
        owner.set(s, e.entity);
      }
    }
  });

  it('REST webhookEventTypeSchema options equal the registry', () => {
    expect(sorted(webhookEventTypeSchema.options)).toEqual(registryNames);
  });

  it('SUPPORTED_WEBHOOK_EVENTS and the retry envelope enum equal the registry', () => {
    expect(sorted(SUPPORTED_WEBHOOK_EVENTS)).toEqual(registryNames);
    expect(sorted(deliveryEnvelopeSchema.shape.event_type.options)).toEqual(registryNames);
  });

  it('OpenAPI WebhookEventTypeV1 enum equals the registry', () => {
    const doc: any = buildBaseRegistry().buildDocument({ title: 't', version: '1' } as any);
    expect(sorted(doc.components.schemas.WebhookEventTypeV1.enum)).toEqual(registryNames);
    expect(sorted(doc.components.schemas.TicketWebhookEventV1.enum)).toEqual(
      registryNames.filter((n) => n.startsWith('ticket.')),
    );
  });

  describe('listings', () => {
    const proto: any = ApiWebhookController.prototype;
    beforeEach(() => {
      proto.authenticate = async (req: any) => {
        req.context = { tenant: 'tenant-a', userId: 'user-1' };
        return req;
      };
      proto.checkPermission = async () => undefined;
    });

    it('controller GET /webhooks/events equals the registry', async () => {
      const response = await new ApiWebhookController().listEvents()(
        new NextRequest('http://localhost/api/v1/webhooks/events', { headers: { 'x-api-key': 'x' } }) as any,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(sorted(body.data)).toEqual(registryNames);
    });

    it('admin listWebhookEvents equals the registry', async () => {
      const result = await (listWebhookEvents as unknown as (u: any, c: any) => Promise<string[]>)(
        { user_id: 'u', tenant: 't' },
        {},
      );
      expect(sorted(result)).toEqual(registryNames);
    });
  });
});

