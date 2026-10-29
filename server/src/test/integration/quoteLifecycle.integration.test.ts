/** Real quote writes, transaction owners, durable receipts and signed HTTP delivery; no app server. */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { EventSchemas, WORKFLOW_EVENT_CATALOG } from '@alga-psa/event-schemas';
import { withTransaction } from '@alga-psa/db';
import Quote from '../../../../packages/billing/src/models/quote';
import { Quote as WorkerQuote } from '../../../../shared/workflow/runtime/actions/businessOperations/crmWorkerDal';
import { transitionQuoteStatus } from '../../../../shared/lib/quotes/quoteLifecycleEvents';
import { withWebhookDeliveryReceipt } from '@/lib/webhooks/deliveryReceipt';
import { quoteWebhookSubscriber } from '@/lib/eventBus/subscribers/entityWebhookSubscribers';
import { processWebhookDeliveryJob } from '@/lib/webhooks/processWebhookDeliveryJob';
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from '@/lib/webhooks/sign';

const state = vi.hoisted(() => ({
  db: null as any,
  tenant: '',
  userId: '',
  contactId: '',
  events: [] as any[],
  jobs: [] as any[],
  sub: null as any,
}));
vi.mock('server/src/lib/db', () => ({
  runWithTenant: async (_tenant: string, fn: any) => fn(),
}));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  getTenantDefaultLocale: async () => 'en',
}));
vi.mock('@alga-psa/tenancy/lib/tenantDefaultCountry', () => ({
  resolveTenantDefaultCountry: async () => ({ code: 'US' }),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => state.db }));
vi.mock('@alga-psa/auth', async (original) => ({
  ...(await original<any>()),
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn(
        {
          user_id: state.userId,
          tenant: state.tenant,
          user_type: 'client',
          contact_id: state.contactId,
          roles: [],
        },
        { tenant: state.tenant },
        ...args
      ),
}));
vi.mock(
  '../../../../packages/client-portal/src/actions/client-portal-actions/clientBillingPermissions',
  async (original) => ({
    ...(await original<any>()),
    hasClientBillingReadPermission: async () => true,
  })
);
vi.mock('@alga-psa/db', async (original) => ({
  ...(await original<any>()),
  getConnection: async () => state.db,
  createTenantKnex: async () => ({ knex: state.db, tenant: state.tenant }),
}));
vi.mock('@alga-psa/event-bus/eventBus', async (original) => ({
  ...(await original<any>()),
  getEventBus: () => ({
    publish: async (e: any, options: any) => {
      if (options?.channel) return;
      const event = {
        ...e,
        id: options?.eventId ?? randomUUID(),
        timestamp: new Date().toISOString(),
      };
      EventSchemas[event.eventType as keyof typeof EventSchemas].parse(event);
      state.events.push(event);
      await quoteWebhookSubscriber.handle(event);
    },
  }),
}));
vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: {
    listForEventType: async (tenant: string, type: string) =>
      state.sub && tenant === state.tenant && type === 'quote.accepted'
        ? [state.sub]
        : [],
    getById: async () => state.sub,
    getSigningSecret: async () => 'quote-test-signing-secret',
    recordDelivery: async () => {},
    updateStats: async () => {},
  },
}));
vi.mock('@/lib/webhooks/WebhookDeliveryQueue', () => ({
  WebhookDeliveryQueue: {
    getInstance: () => ({
      enqueue: async (job: any) => {
        state.jobs.push(job);
      },
    }),
  },
}));
vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: {
    getInstance: () => ({ tryConsume: async () => ({ allowed: true }) }),
  },
}));
vi.mock('@/lib/webhooks/autoDisable', () => ({
  maybeAutoDisable: async () => {},
}));

let db: Knex;
let tenant: string;
let clientId: string;
let userId: string;
let contactId: string;
let sink: Server;
let sinkUrl: string;
const requests: { headers: any; body: string }[] = [];
const originalPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

async function seedQuote(status = 'draft', extra: object = {}) {
  const quoteId = randomUUID();
  await db('quotes').insert({
    tenant,
    quote_id: quoteId,
    client_id: clientId,
    quote_number: `Q-${quoteId}`,
    title: 'Lifecycle quote',
    status,
    version: 1,
    is_template: false,
    currency_code: 'USD',
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    discount_total: 0,
    ...extra,
  });
  return quoteId;
}

describe('quote lifecycle operational paths', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({
      databaseName: process.env.QUOTE_TEST_DB || 'test_quote_lifecycle_2897',
      runSeeds: true,
    });
    state.db = db;
    tenant = randomUUID();
    clientId = randomUUID();
    userId = randomUUID();
    contactId = randomUUID();
    state.tenant = tenant;
    state.userId = userId;
    state.contactId = contactId;
    await db('tenants').insert({
      tenant,
      client_name: 'Quote event test',
      email: 'quote@test.invalid',
      billing_source: 'test',
    });
    await db('clients').insert({
      tenant,
      client_id: clientId,
      client_name: 'Quote test client',
    });
    await db('contacts').insert({
      tenant,
      contact_name_id: contactId,
      client_id: clientId,
      full_name: 'Casey Contact',
    });
    await db('users').insert({
      tenant,
      user_id: userId,
      username: `quote-${userId}`,
      email: 'quote@test.invalid',
      first_name: 'Ari',
      last_name: 'Admin',
      hashed_password: 'x',
      user_type: 'internal',
    });
    sink = createServer(async (req, res) => {
      let body = '';
      for await (const part of req) body += part;
      requests.push({ headers: req.headers, body });
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve));
    sinkUrl = `http://127.0.0.1:${(sink.address() as any).port}/quotes`;
    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';
  }, 600_000);
  beforeEach(() => {
    state.events.length = 0;
    state.jobs.length = 0;
    state.sub = null;
    requests.length = 0;
  });
  afterAll(async () => {
    if (sink) await new Promise<void>((resolve) => sink.close(() => resolve()));
    await db?.destroy();
    if (originalPrivate === undefined)
      delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    else process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalPrivate;
  });

  it('captures final totals, selected optional IDs and contact actor after commit; rollback publishes nothing', async () => {
    const id = await seedQuote('sent');
    const itemId = randomUUID();
    await db('quote_items').insert({
      tenant,
      quote_id: id,
      quote_item_id: itemId,
      description: 'Selected option',
      quantity: 1,
      unit_price: 2400,
      total_price: 2400,
      net_amount: 2400,
      is_optional: true,
      is_selected: true,
      is_taxable: false,
    });
    await withTransaction(db, async (trx) => {
      await Quote.update(
        trx,
        tenant,
        id,
        {
          status: 'accepted',
          updated_by: userId,
          accepted_at: new Date().toISOString(),
        },
        {
          actor: { actorType: 'CONTACT', actorContactId: contactId },
          acceptedOnBehalf: false,
        }
      );
      expect(state.events).toHaveLength(0);
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      eventType: 'QUOTE_ACCEPTED',
      payload: {
        quoteId: id,
        totalAmount: 2400,
        actorType: 'CONTACT',
        actorContactId: contactId,
        performedById: contactId,
        acceptedByName: 'Casey Contact',
        selectedOptionalItemIds: [itemId],
        acceptedOnBehalf: false,
      },
    });
    const rolledBack = await seedQuote('sent');
    await expect(
      withTransaction(db, async (trx) => {
        await Quote.update(trx, tenant, rolledBack, { status: 'accepted' });
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(state.events).toHaveLength(1);
    expect(
      (await db('quotes').where({ tenant, quote_id: rolledBack }).first())
        .status
    ).toBe('sent');
  });

  it('portal first view is recorded once under concurrency and acceptance uses the contact actor', async () => {
    const { getClientQuoteById, acceptClientQuote } =
      await import('../../../../packages/client-portal/src/actions/client-portal-actions/client-billing');
    const id = await seedQuote('sent', { contact_id: contactId });
    await Promise.all([getClientQuoteById(id), getClientQuoteById(id)]);
    expect(state.events.map((e) => e.eventType)).toEqual(['QUOTE_VIEWED']);
    await acceptClientQuote(id, []);
    expect(state.events[1]).toMatchObject({
      eventType: 'QUOTE_ACCEPTED',
      payload: {
        actorType: 'CONTACT',
        actorContactId: contactId,
        acceptedOnBehalf: false,
      },
    });
  });

  it('a competing portal acceptance cannot overwrite the selections captured by the winning transition', async () => {
    const { acceptClientQuote } =
      await import('../../../../packages/client-portal/src/actions/client-portal-actions/client-billing');
    const id = await seedQuote('sent', { contact_id: contactId });
    const options = [randomUUID(), randomUUID()];
    await db('quote_items').insert(
      options.map((itemId) => ({
        tenant,
        quote_id: id,
        quote_item_id: itemId,
        description: 'Optional service',
        is_optional: true,
        is_selected: false,
        quantity: 1,
        unit_price: 500,
        is_taxable: false,
      }))
    );
    const results = await Promise.all(
      options.map((option) => acceptClientQuote(id, [option]))
    );
    expect(
      results.filter((result: any) => result.status === 'accepted')
    ).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    const selected = await db('quote_items')
      .where({ tenant, quote_id: id, is_selected: true })
      .select('quote_item_id');
    expect(state.events[0].payload.selectedOptionalItemIds).toEqual(
      selected.map((item) => item.quote_item_id)
    );
  });

  it.each([
    ['pending_approval', 'approved', 'QUOTE_APPROVED'],
    ['sent', 'rejected', 'QUOTE_REJECTED'],
    ['sent', 'cancelled', 'QUOTE_CANCELLED'],
  ])(
    'publishes %s → %s with its complete event contract',
    async (before, after, eventType) => {
      const id = await seedQuote(before);
      await Quote.update(db, tenant, id, {
        status: after as any,
        updated_by: userId,
        rejection_reason: after === 'rejected' ? 'Budget' : null,
      });
      expect(state.events).toHaveLength(1);
      expect(state.events[0]).toMatchObject({
        eventType,
        payload: {
          previousStatus: before,
          newStatus: after,
          performedByType: 'USER',
        },
      });
    }
  );

  it('a rolled-back raw outer transaction never publishes queued transitions', async () => {
    const id = await seedQuote('draft');
    await expect(
      db.transaction(async (trx) => {
        await Quote.update(trx, tenant, id, { status: 'sent' });
        throw new Error('outer rollback');
      })
    ).rejects.toThrow('outer rollback');
    expect(state.events).toHaveLength(0);
  });

  it('serializes competing transitions and suppresses resend and ordinary edits on root connections', async () => {
    const id = await seedQuote();
    await Promise.all([
      Quote.update(db, tenant, id, { status: 'sent', updated_by: userId }),
      Quote.update(db, tenant, id, { status: 'sent', updated_by: userId }),
    ]);
    await Quote.update(db, tenant, id, { title: 'Edited quote' });
    expect(state.events.map((e) => e.eventType)).toEqual(['QUOTE_SENT']);
  });

  it('worker and billing expire-on-read racing produce one expiration and activity', async () => {
    const id = await seedQuote('sent', { valid_until: '2000-01-01' });
    const { expireQuotesHandler } =
      await import('@/lib/jobs/handlers/expireQuotesHandler');
    await Promise.all([
      Quote.getById(db, tenant, id),
      WorkerQuote.getById(db, tenant, id),
      expireQuotesHandler({ tenantId: tenant }),
    ]);
    expect(state.events.map((e) => e.eventType)).toEqual(['QUOTE_EXPIRED']);
    expect(
      await db('quote_activities').where({
        tenant,
        quote_id: id,
        activity_type: 'expired',
      })
    ).toHaveLength(1);
  });

  it('worker send uses the same emitter and suppresses rollback', async () => {
    const id = await seedQuote();
    await WorkerQuote.update(db, tenant, id, {
      status: 'sent',
      updated_by: userId,
    });
    expect(state.events[0]).toMatchObject({
      eventType: 'QUOTE_SENT',
      payload: { performedByType: 'USER', performedById: userId },
    });
    const other = await seedQuote();
    await expect(
      withTransaction(db, async (trx) => {
        await WorkerQuote.update(trx, tenant, other, { status: 'sent' });
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(state.events).toHaveLength(1);
  });

  it('revision creation emits a supersession referencing the actual new quote', async () => {
    const id = await seedQuote('accepted');
    const revision = await Quote.createRevision(db, tenant, id, userId);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      eventType: 'QUOTE_SUPERSEDED',
      payload: {
        quoteId: id,
        supersededByQuoteId: revision.quote_id,
        nextVersion: 2,
      },
    });
  });

  it('keeps conversion/reversion/reconversion distinct and refuses non-system reversion', async () => {
    const id = await seedQuote('accepted');
    // Empty destination IDs are rejected by builders in real conversion tests; this exercises the system-only seam.
    await transitionQuoteStatus(db, tenant, id, 'converted', {
      reason: 'Conversion',
      patch: {},
      details: { salesOrderId: randomUUID() },
    });
    await expect(
      transitionQuoteStatus(db, tenant, id, 'accepted', {
        reason: 'User reversion',
      })
    ).rejects.toThrow('Invalid quote status transition');
    await transitionQuoteStatus(db, tenant, id, 'accepted', {
      reason: 'Invoice deletion',
      system: true,
      details: { releasedInvoiceId: randomUUID() },
    });
    await transitionQuoteStatus(db, tenant, id, 'converted', {
      reason: 'Reconversion',
      details: { salesOrderId: randomUUID() },
    });
    expect(state.events.map((e) => e.eventType)).toEqual([
      'QUOTE_CONVERTED',
      'QUOTE_CONVERSION_REVERTED',
      'QUOTE_CONVERTED',
    ]);
    expect(new Set(state.events.map((e) => e.id)).size).toBe(3);
  });

  it('invoice-only conversion and actual draft deletion publish reversion, then reconversion gets a new ID', async () => {
    const { convertQuoteToDraftInvoice } =
      await import('../../../../packages/billing/src/services/quoteConversionService');
    const { deleteInvoiceWithKnex } =
      await import('../../../../packages/billing/src/actions/invoiceModification');
    const id = await seedQuote('accepted', {
      accepted_at: new Date().toISOString(),
    });
    await db('quote_items').insert({
      tenant,
      quote_id: id,
      description: 'One-time labor',
      quantity: 1,
      unit_price: 1200,
      total_price: 1200,
      net_amount: 1200,
      is_taxable: false,
    });
    const first = await convertQuoteToDraftInvoice(db, tenant, id, userId);
    expect(first.quote.status).toBe('converted');
    expect(state.events[0]).toMatchObject({
      eventType: 'QUOTE_CONVERTED',
      payload: {
        invoiceId: first.invoice.invoice_id,
        conversionTargets: ['invoice'],
      },
    });
    await deleteInvoiceWithKnex(db, tenant, first.invoice.invoice_id, userId, {
      requireDraft: true,
    });
    expect(state.events[1]).toMatchObject({
      eventType: 'QUOTE_CONVERSION_REVERTED',
      payload: { releasedInvoiceId: first.invoice.invoice_id },
    });
    await convertQuoteToDraftInvoice(db, tenant, id, userId);
    const events = state.events.filter((e) => e.eventType.startsWith('QUOTE_'));
    expect(events.map((e) => e.eventType)).toEqual([
      'QUOTE_CONVERTED',
      'QUOTE_CONVERSION_REVERTED',
      'QUOTE_CONVERTED',
    ]);
    expect(events[2].id).not.toBe(events[0].id);
  });

  it.each([
    ['worker', 'combined'],
    ['worker', 'incremental'],
    ['server', 'combined'],
    ['server', 'incremental'],
  ] as const)(
    '%s %s conversion rolls back atomically and retries preserve records and events',
    async (runtime, mode) => {
      const conversions =
        runtime === 'worker'
          ? await import('../../../../shared/workflow/runtime/actions/businessOperations/crmWorkerDal')
          : await import('../../../../packages/billing/src/services/quoteConversionService');
      const serviceId = randomUUID();
      const serviceType = await db('service_types').where({ tenant }).first();
      const typeId = serviceType?.id ?? randomUUID();
      if (!serviceType) {
        const template = await db('service_types').first();
        await db('service_types').insert({ ...template, id: typeId, tenant });
      }
      await db('service_catalog').insert({
        tenant,
        service_id: serviceId,
        custom_service_type_id: typeId,
        service_name: 'Lifecycle recurring service',
        billing_method: 'fixed',
        default_rate: 1000,
        unit_of_measure: 'each',
      });
      const id = await seedQuote('accepted', {
        accepted_at: new Date().toISOString(),
      });
      await db('quote_items').insert([
        {
          tenant,
          quote_id: id,
          service_id: serviceId,
          description: 'Recurring',
          quantity: 1,
          unit_price: 1000,
          total_price: 1000,
          net_amount: 1000,
          is_recurring: true,
          billing_frequency: 'monthly',
          billing_method: 'fixed',
          is_taxable: false,
        },
        {
          tenant,
          quote_id: id,
          service_id: null,
          description: 'Setup',
          quantity: 1,
          unit_price: 500,
          total_price: 500,
          net_amount: 500,
          is_recurring: false,
          billing_frequency: null,
          billing_method: 'fixed',
          is_taxable: false,
        },
      ]);
      const convert = async (conn: Knex | Knex.Transaction) => {
        if (mode === 'combined') {
          return conversions.convertQuoteToDraftContractAndInvoice(
            conn,
            tenant,
            id,
            userId
          );
        }
        const contractResult = await conversions.convertQuoteToDraftContract(
          conn,
          tenant,
          id,
          userId
        );
        const invoiceResult = await conversions.convertQuoteToDraftInvoice(
          conn,
          tenant,
          id,
          userId
        );
        return {
          ...contractResult,
          invoice: invoiceResult.invoice,
          quote: invoiceResult.quote,
        };
      };
      await expect(
        withTransaction(db, async (trx) => {
          await convert(trx);
          throw new Error('rollback');
        })
      ).rejects.toThrow('rollback');
      expect(state.events).toHaveLength(0);
      expect(
        (await db('quotes').where({ tenant, quote_id: id }).first()).status
      ).toBe('accepted');
      const result = await withTransaction(db, convert);
      expect(state.events).toHaveLength(1);
      expect(state.events[0]).toMatchObject({
        eventType: 'QUOTE_CONVERTED',
        payload: {
          contractId: result.contract.contract_id,
          ...(mode === 'combined'
            ? { invoiceId: result.invoice.invoice_id }
            : {}),
          conversionTargets:
            mode === 'combined' ? ['contract', 'invoice'] : ['contract'],
        },
      });
      const beforeRetry = await db('quotes')
        .where({ tenant, quote_id: id })
        .first();
      const activityCount = await db('quote_activities')
        .where({ tenant, quote_id: id })
        .count('* as count')
        .first();
      const contractRetry = await conversions.convertQuoteToDraftContract(
        db,
        tenant,
        id,
        userId
      );
      const invoiceRetry = await conversions.convertQuoteToDraftInvoice(
        db,
        tenant,
        id,
        userId
      );
      expect(contractRetry.contract.contract_id).toBe(
        result.contract.contract_id
      );
      expect(invoiceRetry.invoice.invoice_id).toBe(result.invoice.invoice_id);
      const afterRetry = await db('quotes')
        .where({ tenant, quote_id: id })
        .first();
      expect(afterRetry).toMatchObject({
        status: 'converted',
        converted_contract_id: result.contract.contract_id,
        converted_invoice_id: result.invoice.invoice_id,
        converted_at: beforeRetry.converted_at,
      });
      expect(
        await db('quote_activities')
          .where({ tenant, quote_id: id })
          .count('* as count')
          .first()
      ).toEqual(activityCount);
      expect(state.events).toHaveLength(1);
    }
  );

  it('rejects incomplete conversion payloads before commit and emits for legacy unassigned quotes', async () => {
    const id = await seedQuote('accepted');
    await expect(
      Quote.update(db, tenant, id, { status: 'converted' })
    ).rejects.toThrow();
    expect(
      (await db('quotes').where({ tenant, quote_id: id }).first()).status
    ).toBe('accepted');
    expect(state.events).toHaveLength(0);
    const legacy = await seedQuote('draft', {
      client_id: null,
      quote_number: null,
    });
    await Quote.update(db, tenant, legacy, { status: 'sent' });
    expect(state.events[0]).toMatchObject({
      eventType: 'QUOTE_SENT',
      payload: { quoteNumber: null, clientId: null },
    });
  });

  it('does not access another tenant quote', async () => {
    const id = await seedQuote('sent');
    await expect(
      Quote.update(db, randomUUID(), id, { status: 'accepted' })
    ).rejects.toThrow('not found');
    expect(state.events).toHaveLength(0);
  });

  it('acceptance delivers one signed HTTP request, including after durable replay suppression', async () => {
    state.sub = {
      tenant,
      webhookId: randomUUID(),
      eventTypes: ['quote.accepted'],
      url: sinkUrl,
      method: 'POST',
      isActive: true,
      customHeaders: null,
      verifySsl: false,
      eventFilter: { entity_ids: [clientId] },
      payloadFields: { quote: ['quote_number', 'accepted_on_behalf'] },
    };
    const id = await seedQuote('sent');
    await Quote.update(db, tenant, id, {
      status: 'accepted',
      updated_by: userId,
    });
    expect(state.jobs).toHaveLength(1);
    await Promise.all([
      processWebhookDeliveryJob(state.jobs[0]),
      processWebhookDeliveryJob(state.jobs[0]),
    ]);
    await processWebhookDeliveryJob(state.jobs[0]);
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(
      verifyWebhookSignature(
        req.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()],
        req.body,
        'quote-test-signing-secret'
      )
    ).toBe(true);
    expect(JSON.parse(req.body)).toMatchObject({
      event_type: 'quote.accepted',
      tenant_id: tenant,
      data: { quote_id: id, accepted_on_behalf: true },
    });
    expect(Object.keys(JSON.parse(req.body).data).sort()).toEqual([
      'accepted_on_behalf',
      'quote_id',
      'quote_number',
    ]);
  });

  it('releases failed delivery leases, then retains success across new consumers', async () => {
    const job = {
      tenantId: tenant,
      webhookId: randomUUID(),
      eventId: randomUUID(),
    };
    const fail = vi.fn(async () => ({ outcome: 'retry' as const }));
    await withWebhookDeliveryReceipt(db, job, fail);
    const success = vi.fn(async () => ({ outcome: 'delivered' as const }));
    await withWebhookDeliveryReceipt(db, job, success);
    await withWebhookDeliveryReceipt(db, job, success);
    expect(success).toHaveBeenCalledOnce();
  });

  it('migrated quote catalog entries match the code catalog', async () => {
    const rows = await db('system_event_catalog').whereLike(
      'event_type',
      'QUOTE_%'
    );
    expect(
      Object.fromEntries(rows.map((r) => [r.event_type, r.payload_schema_ref]))
    ).toEqual(
      Object.fromEntries(
        Object.entries(WORKFLOW_EVENT_CATALOG)
          .filter(([key]) => key.startsWith('QUOTE_'))
          .map(([key, value]) => [key, value.schemaRef])
      )
    );
  });
});
