export { default as MspTicketsPageClient } from './MspTicketsPageClient';
export { default as MspTicketDetailsContainerClient } from './MspTicketDetailsContainerClient';
// registerSlaIntegration is NOT exported here — it pulls in server-only deps (knex, temporal, grpc).
// Import it directly via @alga-psa/msp-composition/tickets/registerSlaIntegration from server components.

