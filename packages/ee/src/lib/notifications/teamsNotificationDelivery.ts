type TeamsNotificationDeliveryResult =
  | { status: 'skipped'; reason: string }
  | { status: 'delivered'; category: 'assignment' | 'customer_reply' | 'approval_request' | 'escalation' | 'sla_risk'; providerMessageId: string | null }
  | { status: 'failed'; category?: 'assignment' | 'customer_reply' | 'approval_request' | 'escalation' | 'sla_risk'; errorCode: string; errorMessage: string; retryable: boolean };

export async function deliverTeamsNotificationImpl(
  _notification: unknown
): Promise<TeamsNotificationDeliveryResult> {
  return {
    status: 'skipped',
    reason: 'delivery_unavailable',
  };
}
