import { publishEvent } from '@alga-psa/event-bus/publishers';

type ServiceRequestDefinitionSearchEventType =
  | 'SERVICE_REQUEST_DEFINITION_CREATED'
  | 'SERVICE_REQUEST_DEFINITION_UPDATED'
  | 'SERVICE_REQUEST_DEFINITION_DELETED';

type ServiceRequestSubmissionSearchEventType =
  | 'SERVICE_REQUEST_SUBMISSION_CREATED'
  | 'SERVICE_REQUEST_SUBMISSION_UPDATED'
  | 'SERVICE_REQUEST_SUBMISSION_DELETED';

export async function publishServiceRequestDefinitionSearchEvent(
  eventType: ServiceRequestDefinitionSearchEventType,
  tenant: string,
  definitionId: string,
  options: {
    userId?: string | null;
    lifecycleState?: string | null;
    changedFields?: string[];
  } = {},
): Promise<void> {
  try {
    await publishEvent({
      eventType,
      payload: {
        tenantId: tenant,
        definitionId,
        userId: options.userId ?? undefined,
        lifecycleState: options.lifecycleState ?? undefined,
        changedFields: options.changedFields,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (eventError) {
    console.error(`[service-request-search] Failed to publish ${eventType}:`, eventError);
  }
}

export async function publishServiceRequestSubmissionSearchEvent(
  eventType: ServiceRequestSubmissionSearchEventType,
  tenant: string,
  submissionId: string,
  options: {
    definitionId?: string;
    clientId?: string | null;
    requesterUserId?: string;
    executionStatus?: string;
    changedFields?: string[];
  } = {},
): Promise<void> {
  try {
    await publishEvent({
      eventType,
      payload: {
        tenantId: tenant,
        submissionId,
        definitionId: options.definitionId,
        clientId: options.clientId ?? undefined,
        requesterUserId: options.requesterUserId,
        executionStatus: options.executionStatus,
        changedFields: options.changedFields,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (eventError) {
    console.error(`[service-request-search] Failed to publish ${eventType}:`, eventError);
  }
}
