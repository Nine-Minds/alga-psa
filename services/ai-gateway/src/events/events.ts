import { randomUUID } from 'node:crypto';
import process from 'node:process';

import type { DeploymentType } from '../db/types.js';

export type GatewayEventType =
  | 'low_balance_crossed'
  | 'entered_grace'
  | 'hard_stop'
  | 'auto_topup_succeeded'
  | 'auto_topup_failed'
  | 'auto_topup_disabled';

export interface GatewayEventInput {
  type: GatewayEventType;
  accountId: string;
  tenantId: string;
  deploymentType: DeploymentType;
  details?: Record<string, string | boolean | null>;
}

export interface GatewayEvent extends GatewayEventInput {
  eventId: string;
  createdAt: string;
}

export interface GatewayEventEmitter {
  emit(event: GatewayEventInput): void;
}

export interface StructuredGatewayEventEmitterOptions {
  webhookUrl?: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

export class StructuredGatewayEventEmitter implements GatewayEventEmitter {
  private readonly webhookUrl: string | undefined;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: StructuredGatewayEventEmitterOptions = {}) {
    this.webhookUrl =
      options.webhookUrl?.trim() || process.env.AI_GATEWAY_EVENTS_WEBHOOK_URL?.trim();
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 2_000;
  }

  emit(input: GatewayEventInput): void {
    const event: GatewayEvent = {
      ...input,
      eventId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    console.info('[ai-gateway-event]', JSON.stringify(event));
    if (!this.webhookUrl) {
      return;
    }

    void this.deliver(event).catch((error: unknown) => {
      console.warn('[ai-gateway] Event webhook delivery failed', error);
    });
  }

  private async deliver(event: GatewayEvent): Promise<void> {
    const webhookUrl = this.webhookUrl;
    if (!webhookUrl) {
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Event webhook returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
