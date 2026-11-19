'use server';

export async function previewCoManagedSeatsAction(_quantity: number): Promise<{
  unitAmount: number; monthlyTotal: number; amountDue: number; currency: string; offerRef: string;
}> {
  throw new Error('Hosted co-managed purchasing requires Enterprise Edition');
}

export async function purchaseCoManagedSeatsAction(_input: { quantity: number; operationId: string; offerRef?: string }): Promise<
  | { kind: 'checkout'; sessionId: string; clientSecret: string; publishableKey: string | null }
  | { kind: 'updated'; subscriptionId: string | null; publishableKey: null }
  | { kind: 'expired'; publishableKey: null }
  | { kind: 'review_required'; offerRef: string; unitAmount: number; currency: string; interval: string; publishableKey: null }
  | { kind: 'unavailable'; reason: string; publishableKey: null }
> {
  throw new Error('Self-hosted co-managed capacity is supplied by a signed license');
}
