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
});
