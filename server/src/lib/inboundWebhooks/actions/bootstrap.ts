let bootstrapped = false;

export async function bootstrapInboundWebhookActions(): Promise<void> {
  if (bootstrapped) {
    return;
  }

  await import('@alga-psa/tickets/actions/inboundActions');
  await import('@alga-psa/clients/actions/inboundActions');
  await import('@alga-psa/assets/actions/inboundActions');
  await import('@alga-psa/billing/actions/inboundActions');
  bootstrapped = true;
}

export function resetInboundWebhookActionBootstrapForTest(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetInboundWebhookActionBootstrapForTest may only be used in tests');
  }

  bootstrapped = false;
}
