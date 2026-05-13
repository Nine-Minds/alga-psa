let bootstrapPromise: Promise<void> | null = null;

export async function bootstrapInboundWebhookActions(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = Promise.all([
      import('@alga-psa/tickets/actions/inboundActions'),
      import('@alga-psa/clients/actions/inboundActions'),
      import('@alga-psa/assets/actions/inboundActions'),
      import('@alga-psa/billing/actions/inboundActions'),
      import('@alga-psa/scheduling/actions/inboundActions'),
      import('@alga-psa/projects/actions/inboundActions'),
      import('@alga-psa/tags/actions/inboundActions'),
    ]).then(() => undefined);
  }
  return bootstrapPromise;
}

export function resetInboundWebhookActionBootstrapForTest(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetInboundWebhookActionBootstrapForTest may only be used in tests');
  }

  bootstrapPromise = null;
}
