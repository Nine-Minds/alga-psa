export interface TicketLiveUpdateActor {
  userId: string;
  displayName: string;
}

export interface PublishTicketUpdateParams {
  tenantId: string;
  ticketId: string;
  updatedFields: string[];
  updatedBy: TicketLiveUpdateActor;
  updatedAt: string;
}

const TICKET_UPDATE_CHANNEL_PREFIX = 'ticket-updates:';

interface RedisPublisherClient {
  publish(channel: string, message: string): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

interface EventBusRedisModule {
  getRedisClient(): Promise<RedisPublisherClient>;
}

let publisherClientPromise: Promise<RedisPublisherClient> | null = null;
let eventBusRedisModuleLoader = defaultEventBusRedisModuleLoader;

function defaultEventBusRedisModuleLoader(): Promise<EventBusRedisModule> {
  return import('@alga-psa/event-bus');
}

export function setTicketUpdateEventBusLoaderForTests(
  loader: (() => Promise<EventBusRedisModule>) | null
): void {
  eventBusRedisModuleLoader = loader ?? defaultEventBusRedisModuleLoader;
  publisherClientPromise = null;
}

function getRedisPrefix(): string {
  return process.env.REDIS_PREFIX || 'alga-psa:';
}

function normalizeJsonbValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonbValue);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeJsonbValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

function areFieldValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJsonbValue(left)) === JSON.stringify(normalizeJsonbValue(right));
}

export function diffTicketFields(
  currentRow: Record<string, unknown> | null | undefined,
  validatedUpdate: Record<string, unknown> | null | undefined
): string[] {
  if (!currentRow || !validatedUpdate) {
    return [];
  }

  return Object.keys(validatedUpdate).filter((fieldName) => {
    const nextValue = validatedUpdate[fieldName];

    if (typeof nextValue === 'undefined') {
      return false;
    }

    return !areFieldValuesEqual(currentRow[fieldName], nextValue);
  });
}

export function getTicketUpdateChannel(tenantId: string, ticketId: string): string {
  return `${getRedisPrefix()}${TICKET_UPDATE_CHANNEL_PREFIX}${tenantId}:${ticketId}`;
}

async function getTicketUpdatePublisherClient(): Promise<RedisPublisherClient> {
  if (!publisherClientPromise) {
    publisherClientPromise = eventBusRedisModuleLoader().then(({ getRedisClient }) => getRedisClient());
  }

  return publisherClientPromise;
}

async function resetTicketUpdatePublisherClient(): Promise<void> {
  const clientPromise = publisherClientPromise;
  publisherClientPromise = null;

  if (!clientPromise) {
    return;
  }

  try {
    const client = await clientPromise;
    await client.disconnect();
  } catch {
    // Ignore disconnect/reset errors for best-effort pub/sub publishing.
  }
}

export async function resetTicketUpdatePublisherClientForTests(): Promise<void> {
  await resetTicketUpdatePublisherClient();
}

export async function publishTicketUpdate(params: PublishTicketUpdateParams): Promise<void> {
  if (process.env.LIVE_TICKET_UPDATES_DISABLED === '1') {
    return;
  }

  if (params.updatedFields.length === 0) {
    return;
  }

  try {
    const client = await getTicketUpdatePublisherClient();
    await client.publish(
      getTicketUpdateChannel(params.tenantId, params.ticketId),
      JSON.stringify({
        updatedFields: params.updatedFields,
        updatedBy: params.updatedBy,
        updatedAt: params.updatedAt,
      })
    );
  } catch (error) {
    console.warn('[publishTicketUpdate] Failed to publish live ticket update:', error);
    await resetTicketUpdatePublisherClient();
  }
}
