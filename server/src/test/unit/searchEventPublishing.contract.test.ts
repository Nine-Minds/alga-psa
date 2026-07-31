import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('search index source event publishing contracts', () => {
  it('T055 client creation publishes CLIENT_CREATED with tenant and client id', () => {
    const source = readRepoFile('packages/clients/src/actions/clientActions.ts');

    expect(source).toContain("eventType: 'CLIENT_CREATED'");
    expect(source).toContain('payload: buildClientCreatedPayload({');
    expect(source).toContain('clientId: createdClient.client_id');
    expect(source).toContain('ctx: {');
    expect(source).toContain('tenantId: tenant');
    expect(source).toContain('idempotencyKey: `client_created:${createdClient.client_id}`');
  });

  it('T056 client update publishes CLIENT_UPDATED with tenant and client id', () => {
    const source = readRepoFile('packages/clients/src/actions/clientActions.ts');

    expect(source).toContain('const updatedPayload = buildClientUpdatedPayload({');
    expect(source).toContain('clientId,');
    expect(source).toContain("eventType: 'CLIENT_UPDATED'");
    expect(source).toContain('payload: updatedPayload');
    expect(source).toContain('ctx: { tenantId: tenant, occurredAt, actor }');
    expect(source).toContain('idempotencyKey: `client_updated:${clientId}:${occurredAt}`');
  });

  it('T057 client deletion publishes CLIENT_DELETED with tenant and client id', () => {
    const source = readRepoFile('packages/clients/src/actions/clientActions.ts');

    expect(source).toContain("eventType: 'CLIENT_DELETED'");
    expect(source).toContain('payload: {');
    expect(source).toContain('clientId,');
    expect(source).toContain('deletedByUserId: user.user_id');
    expect(source).toContain('deletedAt: occurredAt');
    expect(source).toContain('tenantId: tenant');
    expect(source).toContain('idempotencyKey: `client_deleted:${clientId}:${occurredAt}`');
  });

  it('T058 contact CRUD emits CONTACT_* events with tenant context', () => {
    const source = readRepoFile('server/src/lib/api/services/ContactService.ts');

    expect(source).toContain("eventType: 'CONTACT_CREATED'");
    expect(source).toContain('payload: buildContactCreatedPayload({');
    expect(source).toContain('contactId: contact.contact_name_id');
    expect(source).toContain('ctx: { tenantId: context.tenant, occurredAt, actor }');

    expect(source).toContain("eventType: 'CONTACT_UPDATED'");
    expect(source).toContain('payload: updatedPayload');
    expect(source).toContain('idempotencyKey: `contact_updated:${id}:${occurredAt}`');

    expect(source).toContain("eventType: 'CONTACT_DELETED'");
    expect(source).toContain('contactId: id');
    expect(source).toContain('idempotencyKey: `contact_deleted:${id}:${occurredAt}`');
  });

  it('T059 user CRUD and role changes emit USER_* events', () => {
    const source = readRepoFile('packages/users/src/actions/user-actions/userActions.ts');

    expect(source).toContain("eventType: 'USER_CREATED'");
    expect(source).toContain("eventType: 'USER_UPDATED'");
    expect(source).toContain("eventType: 'USER_DELETED'");
    expect(source).toContain("eventType: 'USER_ROLES_UPDATED'");
    expect(source).toContain('tenantId: tenant');
    expect(source).toContain('idempotencyKey: `user_created:${result.user.user_id}:${occurredAt}`');
    expect(source).toContain('idempotencyKey: `user_updated:${userId}:${occurredAt}`');
    expect(source).toContain('idempotencyKey: `user_deleted:${userId}:${occurredAt}`');
    expect(source).toContain('idempotencyKey: `user_roles_updated:${userId}:${occurredAt}`');
  });

  it('T060 project CRUD and child entity CRUD emit project-family events', () => {
    const projectSource = readRepoFile('packages/projects/src/actions/projectActions.ts');
    const taskSource = readRepoFile('packages/projects/src/actions/projectTaskActions.ts');
    const commentSource = readRepoFile('packages/projects/src/actions/projectTaskCommentActions.ts');

    for (const eventType of [
      'PROJECT_CREATED',
      'PROJECT_UPDATED',
      'PROJECT_DELETED',
      'PROJECT_PHASE_CREATED',
      'PROJECT_PHASE_UPDATED',
      'PROJECT_PHASE_DELETED',
    ]) {
      expect(projectSource).toContain(`eventType: '${eventType}'`);
    }

    for (const eventType of [
      'PROJECT_TASK_CREATED',
      'PROJECT_TASK_UPDATED',
      'PROJECT_TASK_DELETED',
    ]) {
      expect(taskSource).toContain(`eventType: '${eventType}'`);
    }

    for (const eventType of [
      'PROJECT_TASK_COMMENT_CREATED',
      'PROJECT_TASK_COMMENT_UPDATED',
      'PROJECT_TASK_COMMENT_DELETED',
    ]) {
      expect(commentSource).toContain(`eventType: '${eventType}'`);
    }
  });

  it('T061 asset CRUD emits ASSET_* events', () => {
    const source = readRepoFile('packages/assets/src/actions/assetActions.ts');

    for (const eventType of ['ASSET_CREATED', 'ASSET_UPDATED', 'ASSET_DELETED']) {
      expect(source).toContain(`eventType: '${eventType}'`);
    }
  });

  it('T062 invoice CRUD, item CRUD, and annotation CRUD emit invoice-family events', () => {
    const serviceSource = readRepoFile('server/src/lib/api/services/InvoiceService.ts');
    const modelSource = readRepoFile('packages/billing/src/models/invoice.ts');
    const modificationSource = readRepoFile('packages/billing/src/actions/invoiceModification.ts');

    for (const eventType of ['INVOICE_CREATED', 'INVOICE_UPDATED', 'INVOICE_DELETED']) {
      expect(serviceSource + modificationSource).toContain(`eventType: '${eventType}'`);
    }

    for (const eventType of ['INVOICE_ITEM_CREATED', 'INVOICE_ITEM_UPDATED', 'INVOICE_ITEM_DELETED']) {
      expect(serviceSource + modelSource + modificationSource).toContain(`eventType: '${eventType}'`);
    }

    for (const eventType of [
      'INVOICE_ANNOTATION_CREATED',
      'INVOICE_ANNOTATION_UPDATED',
      'INVOICE_ANNOTATION_DELETED',
    ]) {
      expect(modelSource + modificationSource).toContain(`eventType: '${eventType}'`);
    }
  });

  it('T063 contract and client-contract CRUD emit contract-family events', () => {
    const contractSource = readRepoFile('packages/billing/src/actions/contractActions.ts');
    const clientContractSource = readRepoFile('packages/clients/src/actions/clientContractActions.ts');

    for (const eventType of ['CONTRACT_CREATED', 'CONTRACT_UPDATED', 'CONTRACT_DELETED']) {
      expect(contractSource + clientContractSource).toContain(`eventType: '${eventType}'`);
    }

    for (const eventType of [
      'CLIENT_CONTRACT_CREATED',
      'CLIENT_CONTRACT_UPDATED',
      'CLIENT_CONTRACT_DELETED',
    ]) {
      expect(contractSource + clientContractSource).toContain(`eventType: '${eventType}'`);
    }
  });

  it('T064 document content and share-list changes emit DOCUMENT_UPDATED', () => {
    const documentSource = readRepoFile('packages/documents/src/actions/documentActions.ts');
    const contentSource = readRepoFile('packages/documents/src/actions/documentBlockContentActions.ts');
    const shareLinkSource = readRepoFile('packages/documents/src/actions/shareLinkActions.ts');

    expect(contentSource).toContain('export const updateBlockContent = withAuth(async');
    expect(contentSource).toContain("eventType: 'DOCUMENT_UPDATED'");

    expect(documentSource).toContain('createDocumentAssociations = withAuth(async');
    expect(documentSource).toContain('removeDocumentAssociations = withAuth(async');
    expect(documentSource).toContain("['document_associations']");
    expect(documentSource).toContain("eventType: 'DOCUMENT_UPDATED'");

    expect(shareLinkSource).toContain('createShareLink = withAuth(');
    expect(shareLinkSource).toContain('revokeShareLink = withAuth(');
    expect(shareLinkSource).toContain("['document_share_links']");
    expect(shareLinkSource).toContain("eventType: 'DOCUMENT_UPDATED'");
  });

  it('T065 service catalog CRUD emits SERVICE_CATALOG_* events', () => {
    const apiServiceSource = readRepoFile('server/src/lib/api/services/ServiceCatalogService.ts');
    const actionSource = readRepoFile('packages/billing/src/actions/serviceActions.ts');

    for (const eventType of [
      'SERVICE_CATALOG_CREATED',
      'SERVICE_CATALOG_UPDATED',
      'SERVICE_CATALOG_DELETED',
    ]) {
      expect(apiServiceSource).toContain(`'${eventType}'`);
      expect(actionSource).toContain(`'${eventType}'`);
    }

    expect(apiServiceSource + actionSource).toContain('publishServiceCatalogSearchEvent');
  });

  it('T066 service-request submissions and definitions emit CRUD search events', () => {
    const definitionSource = readRepoFile('server/src/lib/service-requests/definitionManagement.ts');
    const submissionSource = readRepoFile('server/src/lib/service-requests/submissionService.ts');
    const eventSource = readRepoFile('server/src/lib/service-requests/searchEvents.ts');

    for (const eventType of [
      'SERVICE_REQUEST_DEFINITION_CREATED',
      'SERVICE_REQUEST_DEFINITION_UPDATED',
      'SERVICE_REQUEST_DEFINITION_DELETED',
    ]) {
      expect(definitionSource + eventSource).toContain(`'${eventType}'`);
    }

    for (const eventType of [
      'SERVICE_REQUEST_SUBMISSION_CREATED',
      'SERVICE_REQUEST_SUBMISSION_UPDATED',
      'SERVICE_REQUEST_SUBMISSION_DELETED',
    ]) {
      expect(submissionSource + eventSource).toContain(`'${eventType}'`);
    }
  });

  it('T067 workflow task CRUD and assignment changes emit workflow task events', () => {
    const source = readRepoFile('shared/workflow/persistence/workflowTaskModel.ts');

    for (const eventType of [
      'WORKFLOW_TASK_CREATED',
      'WORKFLOW_TASK_UPDATED',
      'WORKFLOW_TASK_DELETED',
      'WORKFLOW_TASK_ASSIGNMENT_CHANGED',
    ]) {
      expect(source).toContain(`'${eventType}'`);
    }

    expect(source).toContain('updateTaskAssignment: async');
    expect(source).toContain('deleteTask: async');
    expect(source).toContain("changedFields: ['assigned_users']");
  });

  it('T068 interaction, schedule, time-entry, board, category, and tag CRUD emit events', () => {
    const interactionSource =
      readRepoFile('packages/clients/src/actions/interactionActions.ts') +
      readRepoFile('packages/clients/src/actions/interactionCreateHelper.ts');
    const scheduleSource = readRepoFile('packages/scheduling/src/actions/scheduleActions.ts');
    const timeEntrySource =
      readRepoFile('packages/scheduling/src/actions/timeEntryCrudActions.ts') +
      readRepoFile('server/src/lib/api/services/TimeEntryService.ts');
    const boardSource =
      readRepoFile('packages/tickets/src/actions/board-actions/boardActions.ts') +
      readRepoFile('server/src/lib/api/services/BoardService.ts');
    const categorySource =
      readRepoFile('packages/tickets/src/actions/ticketCategoryActions.ts') +
      readRepoFile('packages/reference-data/src/actions/referenceDataActions.ts');
    const tagSource =
      readRepoFile('packages/tags/src/actions/tagActions.ts') +
      readRepoFile('server/src/lib/api/services/TagService.ts');

    for (const eventType of ['INTERACTION_CREATED', 'INTERACTION_UPDATED', 'INTERACTION_DELETED']) {
      expect(interactionSource).toContain(`'${eventType}'`);
    }

    for (const eventType of ['SCHEDULE_ENTRY_CREATED', 'SCHEDULE_ENTRY_UPDATED', 'SCHEDULE_ENTRY_DELETED']) {
      expect(scheduleSource).toContain(`'${eventType}'`);
    }

    for (const eventType of ['TIME_ENTRY_CREATED', 'TIME_ENTRY_UPDATED', 'TIME_ENTRY_DELETED']) {
      expect(timeEntrySource).toContain(`'${eventType}'`);
    }

    for (const eventType of ['BOARD_CREATED', 'BOARD_UPDATED', 'BOARD_DELETED']) {
      expect(boardSource).toContain(`'${eventType}'`);
    }

    for (const eventType of ['CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED']) {
      expect(categorySource).toContain(`'${eventType}'`);
    }

    for (const eventType of ['TAG_DEFINITION_CREATED', 'TAG_DEFINITION_UPDATED', 'TAG_DEFINITION_DELETED']) {
      expect(tagSource).toContain(`'${eventType}'`);
    }
  });
});
