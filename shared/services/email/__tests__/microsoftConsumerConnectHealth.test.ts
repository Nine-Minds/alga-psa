/**
 * The inbound consumer is the only runtime that sees a Graph connect failure
 * for a folder the subscription path silently falls back to Inbox for. These
 * tests pin that a non-transient failure turns the provider card red through
 * the single status writer, that a later success clears it, and that neither a
 * transient failure nor an auth-paused provider's curated message is touched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const tables: Record<string, Row[]> = vi.hoisted(() => ({}));

function createQueryBuilder(rows: Row[]) {
  const predicates: Array<(row: Row) => boolean> = [];
  const builder: any = {
    where(criteria: any, value?: any) {
      if (typeof criteria === 'string') predicates.push((row) => row[criteria] === value);
      else predicates.push((row) => Object.entries(criteria).every(([key, expected]) => row[key] === expected));
      return builder;
    },
    async first(...columns: string[]) {
      const match = rows.find((row) => predicates.every((predicate) => predicate(row)));
      if (!match) return undefined;
      if (!columns.length) return { ...match };
      return Object.fromEntries(columns.map((column) => [column, match[column]]));
    },
    async update(patch: Row) {
      let updated = 0;
      for (const row of rows) {
        if (predicates.every((predicate) => predicate(row))) {
          Object.assign(row, patch);
          updated += 1;
        }
      }
      return updated;
    },
    async insert(row: Row) {
      rows.push({ ...row });
      return [rows.length];
    },
  };
  return builder;
}

const fakeTenantDb = {
  table: (name: string) => createQueryBuilder((tables[name] ||= [])),
};

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => fakeTenantDb,
  getAdminConnection: async () => ({}),
  destroyAdminConnection: async () => undefined,
  refreshAdminConnection: async () => ({}),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => ({}),
}));

const PROVIDER = { id: 'provider-1', tenant: 'tenant-1' };

function providerRow(): Row {
  return tables.email_providers.find((row) => row.id === PROVIDER.id) as Row;
}

function healthRow(): Row | undefined {
  return (tables.email_provider_health || []).find((row) => row.provider_id === PROVIDER.id);
}

function failingAdapter(error: unknown) {
  return { connect: async () => { throw error; } };
}

/** The error `connect()` raises for TopLeft's `INBOX\AlgaInbox` filter. */
function segmentNotFoundError() {
  return Object.assign(new Error("Error in connect: Resource not found for the segment 'AlgaInbox'."), {
    status: 400,
    code: 'ErrorInvalidRequest',
  });
}

/**
 * The error `connect()` raises for a bare top-level filter such as
 * `AlgaInbox`: Graph parses the name as a folder id and rejects it with 400
 * ErrorInvalidIdMalformed before resolution can run.
 */
function malformedIdError() {
  return Object.assign(new Error('Error in connect: Id is malformed.'), {
    status: 400,
    code: 'ErrorInvalidIdMalformed',
  });
}

describe('consumer connect failures surface on the provider card', () => {
  beforeEach(() => {
    tables.email_providers = [{
      id: PROVIDER.id,
      tenant: PROVIDER.tenant,
      status: 'connected',
      error_message: null,
      inbound_paused_at: null,
      inbound_pause_reason: null,
    }];
    tables.email_provider_health = [];
  });

  it('marks the provider in error when connect fails on an unresolvable folder', async () => {
    const { connectMicrosoftAdapterForFetch } = await import('../unifiedInboundEmailQueueJobProcessor');

    await expect(connectMicrosoftAdapterForFetch(failingAdapter(segmentNotFoundError()) as any, PROVIDER))
      .rejects.toThrow(/Resource not found for the segment/);

    expect(providerRow().status).toBe('error');
    expect(String(providerRow().error_message)).toContain('Inbound message fetch failed:');
    expect(String(providerRow().error_message)).toContain("Resource not found for the segment 'AlgaInbox'");
    expect(healthRow()).toMatchObject({
      is_healthy: false,
      subscription_status: 'error',
      last_renewal_result: 'consumer_connect_failed',
    });
  });

  it('marks and then clears the card for a 400 malformed-id folder probe', async () => {
    const { connectMicrosoftAdapterForFetch } = await import('../unifiedInboundEmailQueueJobProcessor');

    await expect(connectMicrosoftAdapterForFetch(failingAdapter(malformedIdError()) as any, PROVIDER))
      .rejects.toThrow(/Id is malformed/);

    expect(providerRow().status).toBe('error');
    expect(String(providerRow().error_message)).toContain('Inbound message fetch failed:');
    expect(String(providerRow().error_message)).toContain('Id is malformed.');
    expect(healthRow()).toMatchObject({ is_healthy: false, last_renewal_result: 'consumer_connect_failed' });

    // The job that follows the deploy reads the red card and clears it.
    await connectMicrosoftAdapterForFetch(
      { connect: async () => undefined } as any,
      { ...PROVIDER, connection_status: 'error' },
    );

    expect(providerRow().status).toBe('connected');
    expect(providerRow().error_message).toBeNull();
  });

  it('clears the consumer-written error on the next successful connect', async () => {
    const { connectMicrosoftAdapterForFetch } = await import('../unifiedInboundEmailQueueJobProcessor');

    await expect(connectMicrosoftAdapterForFetch(failingAdapter(segmentNotFoundError()) as any, PROVIDER))
      .rejects.toThrow();
    expect(providerRow().status).toBe('error');

    await connectMicrosoftAdapterForFetch({ connect: async () => undefined } as any, PROVIDER);

    expect(providerRow().status).toBe('connected');
    expect(providerRow().error_message).toBeNull();
  });

  it('skips the clearing lookup for a provider whose config reads healthy', async () => {
    const { connectMicrosoftAdapterForFetch } = await import('../unifiedInboundEmailQueueJobProcessor');
    Object.assign(providerRow(), {
      status: 'error',
      error_message: 'Inbound message fetch failed: stale red card',
    });

    // The job read `connected` moments earlier, so the healthy fast path runs
    // and leaves the row for the next message to clear.
    await connectMicrosoftAdapterForFetch(
      { connect: async () => undefined } as any,
      { ...PROVIDER, connection_status: 'connected' },
    );

    expect(providerRow().status).toBe('error');
  });

  it('leaves an error written by the subscription path alone', async () => {
    const { connectMicrosoftAdapterForFetch } = await import('../unifiedInboundEmailQueueJobProcessor');
    Object.assign(providerRow(), { status: 'error', error_message: 'Webhook subscription renewal failed' });

    await connectMicrosoftAdapterForFetch({ connect: async () => undefined } as any, PROVIDER);

    expect(providerRow().status).toBe('error');
    expect(providerRow().error_message).toBe('Webhook subscription renewal failed');
  });

  it('does not mark transient throttling or server failures', async () => {
    const { connectMicrosoftAdapterForFetch } = await import('../unifiedInboundEmailQueueJobProcessor');

    for (const status of [429, 503]) {
      await expect(connectMicrosoftAdapterForFetch(
        failingAdapter(Object.assign(new Error('Error in connect: service unavailable'), { status })) as any,
        PROVIDER,
      )).rejects.toThrow(/service unavailable/);
    }
    await expect(connectMicrosoftAdapterForFetch(
      failingAdapter(new Error('timeout:microsoft_connect:30000')) as any,
      PROVIDER,
    )).rejects.toThrow(/timeout/);

    expect(providerRow().status).toBe('connected');
    expect(providerRow().error_message).toBeNull();
    expect(healthRow()).toBeUndefined();
  });

  it('never overwrites the curated message of an auth-failure paused provider', async () => {
    const { connectMicrosoftAdapterForFetch } = await import('../unifiedInboundEmailQueueJobProcessor');
    Object.assign(providerRow(), {
      status: 'error',
      error_message: 'Reconnect required: Microsoft rejected the stored credentials.',
      inbound_paused_at: new Date().toISOString(),
      inbound_pause_reason: 'auth_failure',
    });

    await expect(connectMicrosoftAdapterForFetch(failingAdapter(segmentNotFoundError()) as any, PROVIDER))
      .rejects.toThrow();

    expect(providerRow().error_message).toBe('Reconnect required: Microsoft rejected the stored credentials.');
  });
});
