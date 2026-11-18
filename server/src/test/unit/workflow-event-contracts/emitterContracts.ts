import type { EmitterContracts } from './registryTypes';
import { ticketContracts } from './contracts/tickets';
import { projectContracts } from './contracts/projects';
import { schedulingContracts } from './contracts/scheduling';
import { billingContracts } from './contracts/billing';
import { crmContracts } from './contracts/crm';
import { documentContracts } from './contracts/documents';
import { surveyContracts } from './contracts/surveys';
import { emailContracts } from './contracts/email';
import { notificationContracts } from './contracts/notifications';
import { integrationContracts } from './contracts/integrations';
import { inventoryContracts } from './contracts/inventory';
import { assetContracts } from './contracts/assets';
import { opportunityContracts } from './contracts/opportunities';
import { quoteContracts } from './contracts/quotes';
import { workerSchemaContracts } from './contracts/workerSchemaEvents';
import { projectBillingContracts } from './contracts/projectBilling';

/**
 * Emitter contract registry. One entry per workflow-catalogued event type.
 *
 * The mapped type makes this exhaustive at compile time: adding an event to
 * WORKFLOW_EVENT_CATALOG without an entry here fails `typecheck`.
 *
 * - `covered`: every case calls the real exported builder the product emitter uses, and the
 *   resulting payload must pass the schema the workflow worker uses.
 * - `known-drift`: the emitter fails the contract today (or its builder is not extracted yet).
 *   Tracked against a ticket; the test asserts the harness rejects it.
 * - `no-product-emitter`: the catalog advertises the trigger but nothing fires it.
 */
export const emitterContracts: EmitterContracts = {
  // ---- tickets ----
  ...ticketContracts,
  // ---- projects ----
  ...projectContracts,
  // ---- scheduling / dispatch ----
  ...schedulingContracts,
  // ---- billing ----
  ...billingContracts,
  // ---- crm / tags ----
  ...crmContracts,
  // ---- documents / storage / media ----
  ...documentContracts,
  ...surveyContracts,
  ...emailContracts,
  ...notificationContracts,
  ...integrationContracts,
  ...assetContracts,
  ...inventoryContracts,
  ...projectBillingContracts,
  ...opportunityContracts,
  ...quoteContracts,
  ...workerSchemaContracts,
};
