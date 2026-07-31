import express from 'express';
import { z } from 'zod';
import type { ControlRegistry, EmulatorCore, EmulatorPackage, HostEnv } from '@alga-psa/emulator-host';

export interface RecordedRequest {
  id: number;
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
  receivedAt: string;
}

interface ConfiguredResponse {
  status: number;
  body: unknown;
}

/**
 * Generic webhook receiver: records everything it is sent for later
 * inspection, echoes Graph-style validationToken handshakes, and can be
 * armed to answer with a custom response. Replaces the WireMock
 * webhook-mock fixtures in the E2E stacks.
 */
export class WebhookSinkCore implements EmulatorCore {
  readonly requests: RecordedRequest[] = [];
  response: ConfiguredResponse | null = null;
  private nextId = 1;

  constructor(readonly env: HostEnv) {}

  reset(): void {
    this.requests.length = 0;
    this.response = null;
    this.nextId = 1;
  }

  record(input: Omit<RecordedRequest, 'id' | 'receivedAt'>): RecordedRequest {
    const request: RecordedRequest = {
      ...input,
      id: this.nextId++,
      receivedAt: this.env.clock.now().toISOString(),
    };
    this.requests.push(request);
    return request;
  }
}

const webhookSinkEmulator: EmulatorPackage<WebhookSinkCore> = {
  id: 'webhook-sink',
  displayName: 'Webhook Sink',
  defaultPort: 4030,

  createCore: (env) => new WebhookSinkCore(env),

  wire(router, core) {
    router.use(express.json({ type: () => true, limit: '5mb' }));
    router.use((req, res) => {
      core.record({
        method: req.method,
        path: req.path,
        query: req.query as Record<string, unknown>,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value ?? '')]),
        ),
        body: req.body ?? null,
      });
      // Microsoft Graph subscription validation: echo the token as text.
      const validationToken = req.query.validationToken;
      if (typeof validationToken === 'string') {
        res.status(200).type('text/plain').send(validationToken);
        return;
      }
      if (core.response) {
        res.status(core.response.status).json(core.response.body);
        return;
      }
      res.status(200).json({ ok: true });
    });
  },

  register(reg: ControlRegistry, core) {
    reg.fault({
      name: 'custom-response',
      description: 'Answer every request with a fixed status and JSON body instead of 200 {ok:true}',
      params: z.object({
        status: z.number().int().min(100).max(599),
        body: z.unknown().optional(),
      }),
      arm: ({ status, body }) => {
        core.response = { status, body: body ?? { ok: false } };
      },
      disarm: () => {
        core.response = null;
      },
    });

    reg.action({
      name: 'clear',
      description: 'Drop all recorded requests',
      run: () => {
        const dropped = core.requests.length;
        core.requests.length = 0;
        return { dropped };
      },
    });

    reg.stateView({
      name: 'requests',
      description: 'Recorded requests, oldest first',
      get: () => core.requests,
    });
  },
};

export default webhookSinkEmulator;
export { webhookSinkEmulator as emulator };
