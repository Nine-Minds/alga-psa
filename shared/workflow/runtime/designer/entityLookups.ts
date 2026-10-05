import type { WorkflowPickerKind } from '../jsonSchemaMetadata';

/**
 * The action that loads an entity's details from its id. Events and many actions carry only an
 * entity id (a ticket event has `ticketId`, not the ticket's priority or board); the designer uses
 * this map to offer adding the lookup step that makes those details available to later steps.
 */
export type WorkflowEntityLookupAction = {
  actionId: string;
  version: number;
  /** Input field of the lookup action that takes the entity id. */
  idInputField: string;
  /** Default `saveAs` for the lookup step's output. */
  saveAs: string;
};

export const WORKFLOW_ENTITY_LOOKUP_ACTIONS: Partial<Record<WorkflowPickerKind, WorkflowEntityLookupAction>> = {
  ticket: { actionId: 'tickets.find', version: 1, idInputField: 'ticket_id', saveAs: 'ticketDetails' },
  client: { actionId: 'clients.find', version: 1, idInputField: 'client_id', saveAs: 'clientDetails' },
  contact: { actionId: 'contacts.find', version: 1, idInputField: 'contact_id', saveAs: 'contactDetails' },
  project: { actionId: 'projects.find', version: 1, idInputField: 'project_id', saveAs: 'projectDetails' },
};

export const getWorkflowEntityLookupAction = (kind: string | undefined): WorkflowEntityLookupAction | undefined =>
  kind ? WORKFLOW_ENTITY_LOOKUP_ACTIONS[kind as WorkflowPickerKind] : undefined;
