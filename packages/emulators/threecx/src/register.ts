import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import type { ThreecxEmulatorCore } from './core';

export function register(reg: ControlRegistry, core: ThreecxEmulatorCore): void {
  reg.action({
    name: 'crm-configure',
    description: 'Point the emulated 3CX CRM engine at a tenant: base URL, tenant slug, and API key',
    params: z.object({
      baseUrl: z.string().optional(),
      tenantSlug: z.string().optional(),
      apiKey: z.string().optional(),
    }),
    run: ({ baseUrl, tenantSlug, apiKey }) => core.configure({ baseUrl, tenantSlug, apiKey }),
  });

  reg.action({
    name: 'crm-inbound-call',
    description: 'Simulate an inbound call: GET lookup then POST report-call, exactly as the CRM engine would',
    params: z.object({
      number: z.string(),
      agentEmail: z.string(),
      agentExtension: z.string().optional(),
      answered: z.boolean().optional(),
      durationSeconds: z.number().int().nonnegative().optional(),
    }),
    run: (input) => core.crmInboundCall(input),
  });

  reg.action({
    name: 'crm-outbound-call',
    description: 'Simulate an outbound call: GET lookup then POST report-call with callType Outbound',
    params: z.object({
      number: z.string(),
      agentEmail: z.string(),
      agentExtension: z.string().optional(),
      durationSeconds: z.number().int().nonnegative().optional(),
    }),
    run: (input) => core.crmOutboundCall(input),
  });

  reg.action({
    name: 'crm-search',
    description: 'Simulate a free-text search from the 3CX client (GET search)',
    params: z.object({ q: z.string() }),
    run: ({ q }) => core.crmSearch(q),
  });

  reg.stateView({
    name: 'config',
    description: 'The configured target (API key masked)',
    get: () => core.redactedTarget(),
  });

  reg.stateView({
    name: 'exchanges',
    description: 'Every request/response pair the emulator sent, with status codes',
    get: () => core.exchanges,
  });
}
