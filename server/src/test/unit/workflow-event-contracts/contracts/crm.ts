import {
  buildClientAnniversaryUpcomingPayload,
  buildClientArchivedPayload,
  buildClientCreatedPayload,
  buildClientMergedPayload,
  buildClientOwnerAssignedPayload,
  buildClientStatusChangedPayload,
  buildClientUpdatedPayload,
  buildContactArchivedPayload,
  buildContactCreatedPayload,
  buildContactPrimarySetPayload,
  buildContactUpdatedPayload,
  buildInteractionLoggedPayload,
  buildNoteCreatedPayload,
  buildTagAppliedPayload,
  buildTagDefinitionCreatedPayload,
  buildTagDefinitionUpdatedPayload,
  buildTagRemovedPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { NO_EMITTER_UMBRELLA_TICKET } from '../registryTypes';
import { IDS, NOW, EARLIER } from '../fixtures';

/**
 * CRM / tags. Client, contact, interaction/note and tag events are all built by
 * domainEventBuilders and published with publishWorkflowEvent. The two sites that used to hand
 * build their payload (TagService, the opportunity client-promotion) now use the same builders.
 */

const CLIENT_ACTIONS = 'packages/clients/src/actions/clientActions.ts';
const CLIENT_SERVICE = 'server/src/lib/api/services/ClientService.ts';
const CONTACT_ACTIONS = 'packages/clients/src/actions/contact-actions/contactActions.tsx';
const CONTACT_SERVICE = 'server/src/lib/api/services/ContactService.ts';
const TAG_ACTIONS = 'packages/tags/src/actions/tagActions.ts';
const TAG_SERVICE = 'server/src/lib/api/services/TagService.ts';

type CrmEventType =
  | 'CLIENT_CREATED'
  | 'CLIENT_UPDATED'
  | 'CLIENT_STATUS_CHANGED'
  | 'CLIENT_OWNER_ASSIGNED'
  | 'CLIENT_MERGED'
  | 'CLIENT_ARCHIVED'
  | 'CLIENT_ANNIVERSARY_UPCOMING'
  | 'CONTACT_CREATED'
  | 'CONTACT_UPDATED'
  | 'CONTACT_PRIMARY_SET'
  | 'CONTACT_ARCHIVED'
  | 'CONTACT_MERGED'
  | 'INTERACTION_LOGGED'
  | 'NOTE_CREATED'
  | 'TAG_DEFINITION_CREATED'
  | 'TAG_DEFINITION_UPDATED'
  | 'TAG_APPLIED'
  | 'TAG_REMOVED';

const user = { actor: { actorType: 'USER' as const, actorUserId: IDS.user } };

const clientBefore = {
  client_id: IDS.client,
  client_name: 'Acme Corp',
  account_manager_id: IDS.previousAssignee,
  billing_contact_id: IDS.contact,
  is_inactive: false,
  lifecycle_status: 'prospect',
  properties: { industry: 'Manufacturing', website: 'https://acme.example' },
  updated_at: EARLIER,
};
const clientAfter = {
  ...clientBefore,
  client_name: 'Acme Corporation',
  account_manager_id: IDS.assignee,
  properties: { industry: 'Logistics', website: 'https://acme.example' },
  updated_at: NOW,
};

const contactBefore = {
  contact_name_id: IDS.contact,
  client_id: IDS.client,
  full_name: 'Jane Doe',
  email: 'jane@acme.example',
  role: 'Office manager',
  updated_at: EARLIER,
};
const contactAfter = { ...contactBefore, full_name: 'Jane Q. Doe', role: 'Operations lead', updated_at: NOW };

export const crmContracts = {
  CLIENT_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${CLIENT_ACTIONS}#createClient`,
        ctx: { ...user, occurredAt: EARLIER },
        build: () =>
          buildClientCreatedPayload({
            clientId: IDS.client,
            clientName: 'Acme Corp',
            createdByUserId: IDS.user,
            createdAt: EARLIER,
            status: 'active',
          }),
      },
      {
        // inbound email / integrations create clients with no acting user: no actor on the ctx.
        site: 'packages/clients/src/actions/inboundActions.ts#clientInboundActions',
        ctx: { actor: undefined, occurredAt: EARLIER },
        build: () =>
          buildClientCreatedPayload({ clientId: IDS.client, clientName: 'Acme Corp', createdAt: EARLIER, status: 'active' }),
      },
    ],
  },
  CLIENT_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${CLIENT_ACTIONS}#updateClient`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildClientUpdatedPayload({
            clientId: IDS.client,
            before: clientBefore,
            after: clientAfter,
            updatedFieldKeys: ['client_name', 'properties', 'updated_at'],
            updatedAt: NOW,
          }),
      },
    ],
  },
  CLIENT_STATUS_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: `${CLIENT_ACTIONS}#updateClient`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildClientStatusChangedPayload({
            clientId: IDS.client,
            previousStatus: 'prospect',
            newStatus: 'active',
            changedAt: NOW,
          }),
      },
      {
        site: 'packages/opportunities/src/lib/clientLifecyclePromotion.ts#promoteProspectClientAfterWin',
        ctx: { actor: undefined, occurredAt: NOW },
        build: () =>
          buildClientStatusChangedPayload({
            clientId: IDS.client,
            previousStatus: 'prospect',
            newStatus: 'active',
            changedAt: NOW,
          }),
      },
    ],
  },
  CLIENT_OWNER_ASSIGNED: {
    status: 'covered',
    cases: [
      {
        site: `${CLIENT_ACTIONS}#updateClient`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildClientOwnerAssignedPayload({
            clientId: IDS.client,
            previousOwnerUserId: IDS.previousAssignee,
            newOwnerUserId: IDS.assignee,
            assignedByUserId: IDS.user,
            assignedAt: NOW,
          }),
      },
      {
        site: `${CLIENT_SERVICE}#ClientService.update`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildClientOwnerAssignedPayload({
            clientId: IDS.client,
            newOwnerUserId: IDS.assignee,
            assignedByUserId: IDS.user,
            assignedAt: NOW,
          }),
      },
    ],
  },
  CLIENT_MERGED: {
    status: 'covered',
    cases: [
      {
        site: 'packages/clients/src/actions/clientMergeActions.ts#mergeClientIntoParent',
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildClientMergedPayload({
            sourceClientId: IDS.otherClient,
            targetClientId: IDS.client,
            mergedByUserId: IDS.user,
            mergedAt: NOW,
            strategy: 'merge_into_billing_profile',
          }),
      },
    ],
  },
  CLIENT_ARCHIVED: {
    status: 'covered',
    cases: [
      {
        site: `${CLIENT_ACTIONS}#updateClient`,
        ctx: { ...user, occurredAt: NOW },
        build: () => buildClientArchivedPayload({ clientId: IDS.client, archivedByUserId: IDS.user, archivedAt: NOW }),
      },
      {
        site: `${CLIENT_ACTIONS}#markClientInactiveWithContacts`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildClientArchivedPayload({
            clientId: IDS.client,
            archivedByUserId: IDS.user,
            archivedAt: NOW,
            reason: 'Contract ended',
          }),
      },
    ],
  },
  CLIENT_ANNIVERSARY_UPCOMING: {
    status: 'covered',
    cases: [
      {
        site: 'packages/jobs/src/lib/dateTriggers/sources/clientAnniversary.ts#clientAnniversarySource',
        ctx: { actor: { actorType: 'SYSTEM' }, occurredAt: NOW },
        build: () =>
          buildClientAnniversaryUpcomingPayload({
            clientId: IDS.client,
            clientName: 'Acme Corp',
            anniversaryDate: '2026-08-14',
            yearsAsClient: 5,
            daysUntilAnniversary: 29,
          }),
      },
    ],
  },

  CONTACT_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${CONTACT_ACTIONS}#addContact`,
        ctx: { ...user, occurredAt: EARLIER },
        build: () =>
          buildContactCreatedPayload({
            contactId: IDS.contact,
            clientId: IDS.client,
            fullName: 'Jane Doe',
            email: 'jane@acme.example',
            primaryEmailCanonicalType: 'work',
            primaryEmailCustomTypeId: null,
            primaryEmailType: 'work',
            additionalEmailAddresses: [],
            phoneNumbers: [],
            defaultPhoneNumber: '+1 555 0100',
            defaultPhoneType: 'work',
            createdByUserId: IDS.user,
            createdAt: EARLIER,
          }),
      },
      {
        // inbound email: contact created for an unknown sender, no acting user.
        site: 'shared/workflow/actions/emailWorkflowActions.ts#createContactForInboundSender',
        ctx: { actor: undefined, occurredAt: EARLIER },
        build: () =>
          buildContactCreatedPayload({
            contactId: IDS.contact,
            clientId: IDS.client,
            fullName: 'jane',
            email: 'jane@acme.example',
            createdAt: EARLIER,
          }),
      },
    ],
  },
  CONTACT_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${CONTACT_ACTIONS}#updateContact`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildContactUpdatedPayload({
            contactId: IDS.contact,
            clientId: IDS.client,
            before: contactBefore,
            after: contactAfter,
            updatedFieldKeys: ['full_name', 'role', 'updated_at'],
            updatedByUserId: IDS.user,
            updatedAt: NOW,
          }),
      },
    ],
  },
  CONTACT_PRIMARY_SET: {
    status: 'covered',
    cases: [
      {
        site: `${CLIENT_ACTIONS}#updateClient`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildContactPrimarySetPayload({
            clientId: IDS.client,
            contactId: IDS.contact,
            previousPrimaryContactId: IDS.otherContact,
            setByUserId: IDS.user,
            setAt: NOW,
          }),
      },
    ],
  },
  CONTACT_ARCHIVED: {
    status: 'covered',
    cases: [
      {
        site: `${CONTACT_ACTIONS}#updateContact`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildContactArchivedPayload({
            contactId: IDS.contact,
            clientId: IDS.client,
            archivedByUserId: IDS.user,
            archivedAt: NOW,
          }),
      },
    ],
  },
  CONTACT_MERGED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason:
      'Catalogued (buildContactMergedPayload exists) but no product code merges contacts or publishes CONTACT_MERGED.',
  },

  INTERACTION_LOGGED: {
    status: 'covered',
    cases: [
      {
        site: 'packages/clients/src/actions/interactionCreateHelper.ts#publishInteractionCreatedSideEffects',
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildInteractionLoggedPayload({
            interactionId: IDS.interaction,
            clientId: IDS.client,
            contactId: IDS.contact,
            interactionType: 'Phone Call',
            interactionOccurredAt: NOW,
            loggedByUserId: IDS.user,
            subject: 'Renewal discussion',
            outcome: 'Completed',
          }),
      },
      {
        site: 'packages/clients/src/actions/interactionCreateHelper.ts#publishInteractionCreatedSideEffects',
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildInteractionLoggedPayload({
            interactionId: IDS.interaction,
            clientId: IDS.client,
            interactionType: 'interaction',
            interactionOccurredAt: NOW,
            loggedByUserId: IDS.user,
          }),
      },
    ],
  },
  NOTE_CREATED: {
    status: 'covered',
    cases: [
      {
        site: 'packages/clients/src/actions/clientNoteActions.ts#saveClientNote',
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildNoteCreatedPayload({
            noteId: IDS.note,
            entityType: 'client',
            entityId: IDS.client,
            createdByUserId: IDS.user,
            createdAt: NOW,
            visibility: 'internal',
            bodyPreview: [{ type: 'paragraph', content: 'Renewal call went well.' }],
          }),
      },
      {
        site: 'packages/clients/src/actions/contact-actions/contactNoteActions.ts#saveContactNote',
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildNoteCreatedPayload({
            noteId: IDS.note,
            entityType: 'contact',
            entityId: IDS.contact,
            createdByUserId: IDS.user,
            createdAt: NOW,
            visibility: 'internal',
            bodyPreview: 'Prefers email.',
          }),
      },
    ],
  },

  TAG_DEFINITION_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${TAG_ACTIONS}#createTag`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildTagDefinitionCreatedPayload({ tagId: IDS.tag, tagName: 'VIP', createdByUserId: IDS.user, createdAt: NOW }),
      },
      {
        site: `${TAG_SERVICE}#TagService.publishTagDefinitionCreated`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildTagDefinitionCreatedPayload({ tagId: IDS.tag, tagName: 'VIP', createdByUserId: IDS.user, createdAt: NOW }),
      },
    ],
  },
  TAG_DEFINITION_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${TAG_ACTIONS}#updateTagText`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildTagDefinitionUpdatedPayload({
            tagId: IDS.tag,
            previousName: 'VIP',
            newName: 'VIP customer',
            updatedByUserId: IDS.user,
            updatedAt: NOW,
          }),
      },
      {
        // TagService only knows the new name when the update changed it.
        site: `${TAG_SERVICE}#TagService.publishTagDefinitionUpdated`,
        ctx: { ...user, occurredAt: NOW },
        build: () => buildTagDefinitionUpdatedPayload({ tagId: IDS.tag, updatedByUserId: IDS.user, updatedAt: NOW }),
      },
    ],
  },
  TAG_APPLIED: {
    status: 'covered',
    cases: [
      {
        site: `${TAG_ACTIONS}#createTag`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildTagAppliedPayload({
            tagId: IDS.tag,
            entityType: 'client',
            entityId: IDS.client,
            appliedByUserId: IDS.user,
            appliedAt: NOW,
          }),
      },
    ],
  },
  TAG_REMOVED: {
    status: 'covered',
    cases: [
      {
        site: `${TAG_ACTIONS}#deleteTag`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildTagRemovedPayload({
            tagId: IDS.tag,
            entityType: 'ticket',
            entityId: IDS.ticket,
            removedByUserId: IDS.user,
            removedAt: NOW,
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, CrmEventType>;
