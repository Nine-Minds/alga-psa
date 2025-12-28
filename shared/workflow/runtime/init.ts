import { getSchemaRegistry } from './registries/schemaRegistry';
import { registerDefaultNodes } from './nodes/registerDefaultNodes';
import { registerEmailWorkflowActionsV2 } from './actions/registerEmailWorkflowActions';
import {
  emailProviderConnectedEventPayloadSchema,
  emailProviderDisconnectedEventPayloadSchema,
  inboundEmailReceivedEventPayloadSchema,
  emailWorkflowPayloadSchema
} from './schemas/emailWorkflowSchemas';
import {
  ticketAssignedEventPayloadSchema,
  ticketClosedEventPayloadSchema,
  ticketCreatedEventPayloadSchema
} from './schemas/ticketEventSchemas';

let initialized = false;

export function initializeWorkflowRuntimeV2(): void {
  if (initialized) return;
  const schemaRegistry = getSchemaRegistry();
  schemaRegistry.register('payload.EmailWorkflowPayload.v1', emailWorkflowPayloadSchema);
  schemaRegistry.register('payload.InboundEmailReceived.v1', inboundEmailReceivedEventPayloadSchema);
  schemaRegistry.register('payload.EmailProviderConnected.v1', emailProviderConnectedEventPayloadSchema);
  schemaRegistry.register('payload.EmailProviderDisconnected.v1', emailProviderDisconnectedEventPayloadSchema);

  schemaRegistry.register('payload.TicketCreated.v1', ticketCreatedEventPayloadSchema);
  schemaRegistry.register('payload.TicketAssigned.v1', ticketAssignedEventPayloadSchema);
  schemaRegistry.register('payload.TicketClosed.v1', ticketClosedEventPayloadSchema);

  registerDefaultNodes();
  registerEmailWorkflowActionsV2();

  initialized = true;
}

export function isWorkflowRuntimeV2Initialized(): boolean {
  return initialized;
}
