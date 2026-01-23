import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

import logger from '../logger';
import { getSecret } from '../secrets';

export interface WorkflowEventBase {
  event_id: string;
  tenant: string;
  execution_id: string;
  event_name: string;
  event_type: string;
  timestamp: string;
  user_id?: string;
  from_state?: string;
  to_state?: string;
  payload?: Record<string, any>;
}

export interface RedisStreamClientOptionsOverrides {
  url?: string;
  streamName?: string;
}

export class RedisStreamClient {
  private client: RedisClientType | null = null;
  private readonly url: string;
  private readonly streamName: string;

  constructor(options: RedisStreamClientOptionsOverrides = {}) {
    this.url = options.url ?? `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`;
    this.streamName = options.streamName ?? 'workflow:events:global';
  }

  async initialize(): Promise<void> {
    if (this.client) return;

    const password = await getSecret('redis_password', 'REDIS_PASSWORD');
    type CreateClientOptions = Parameters<typeof createClient>[0];

    const clientOptions: CreateClientOptions = {
      url: this.url,
      password: password || undefined,
    };

    const client = createClient(clientOptions);

    client.on('error', (err: unknown) => {
      logger.error('[RedisStreamClient] Redis error', { err });
    });

    await client.connect();

    this.client = client as unknown as RedisClientType;
  }

  async publishEvent(event: WorkflowEventBase): Promise<string> {
    if (!this.client) {
      await this.initialize();
    }

    const messageFields: Record<string, string> = {
      event_id: event.event_id,
      execution_id: event.execution_id || '',
      event_name: event.event_name,
      event_type: event.event_type,
      tenant: event.tenant,
      timestamp: event.timestamp,
      user_id: event.user_id || '',
      from_state: event.from_state || '',
      to_state: event.to_state || '',
      payload_json: JSON.stringify(event.payload || {}),
    };

    return await this.client!.xAdd(this.streamName, '*', messageFields);
  }
}
