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

async function defaultEventBusRedisModuleLoader(): Promise<EventBusRedisModule> {
  const { getRedisClient } = await import('./config/redisConfig');
  return {
    getRedisClient: async () => getRedisClient() as Promise<RedisPublisherClient>,
  };
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
