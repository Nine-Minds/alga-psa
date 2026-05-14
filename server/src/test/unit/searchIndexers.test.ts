import { describe, expect, it, vi } from 'vitest';

import { assetIndexer } from '../../lib/search/indexers/asset';
import { clientIndexer } from '../../lib/search/indexers/client';
import { contactIndexer } from '../../lib/search/indexers/contact';
import { contractIndexer } from '../../lib/search/indexers/contract';
import { documentIndexer } from '../../lib/search/indexers/document';
import { invoiceAnnotationIndexer } from '../../lib/search/indexers/invoice_annotation';
import { invoiceItemIndexer } from '../../lib/search/indexers/invoice_item';
import { invoiceIndexer } from '../../lib/search/indexers/invoice';
import { kbArticleIndexer } from '../../lib/search/indexers/kb_article';
import { projectPhaseIndexer } from '../../lib/search/indexers/project_phase';
import { projectTaskCommentIndexer } from '../../lib/search/indexers/project_task_comment';
import { projectTaskIndexer } from '../../lib/search/indexers/project_task';
import { projectIndexer } from '../../lib/search/indexers/project';
import { serviceCatalogIndexer } from '../../lib/search/indexers/service_catalog';
import { serviceRequestDefinitionIndexer } from '../../lib/search/indexers/service_request_definition';
import { serviceRequestSubmissionIndexer } from '../../lib/search/indexers/service_request_submission';
import { ticketIndexer } from '../../lib/search/indexers/ticket';
import { ticketCommentIndexer } from '../../lib/search/indexers/ticket_comment';
import { userIndexer } from '../../lib/search/indexers/user';
import { workflowTaskIndexer } from '../../lib/search/indexers/workflow_task';

function createFirstRowKnex(row: unknown) {
  const joinBuilder = {
    on: vi.fn().mockReturnThis(),
    andOn: vi.fn().mockReturnThis(),
  };
  const queryBuilder = {
    join: vi.fn((_table: string, joinCallback: (this: typeof joinBuilder) => void) => {
      joinCallback.call(joinBuilder);
      return queryBuilder;
    }),
    leftJoin: vi.fn((_table: string, joinCallback: (this: typeof joinBuilder) => void) => {
      joinCallback.call(joinBuilder);
      return queryBuilder;
    }),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(row),
  };
  const knex = vi.fn().mockReturnValue(queryBuilder);
  return { knex, queryBuilder, joinBuilder };
}

function createBatchKnex(rows: unknown[]) {
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn((resolve, reject) => Promise.resolve(rows).then(resolve, reject)),
  };
  const knex = vi.fn().mockReturnValue(queryBuilder);
  return { knex, queryBuilder };
}

describe('search entity indexers', () => {
  it('T027 client loadOne maps client fields into a SearchDoc', async () => {
    const { knex, queryBuilder } = createFirstRowKnex({
      client_id: 'client-1',
      client_name: 'ACME Corp',
      email: 'support@acme.example',
      phone_no: '555-0100',
      notes: 'Managed firewall customer',
      created_at: '2026-05-12T10:00:00.000Z',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await clientIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'client-1',
    );

    expect(knex).toHaveBeenCalledWith('clients');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'tenant',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('client_id', 'client-1');
    expect(doc).toMatchObject({
      tenant: '11111111-1111-4111-8111-111111111111',
      objectType: 'client',
      objectId: 'client-1',
      title: 'ACME Corp',
      subtitle: 'support@acme.example | 555-0100',
      body: 'Managed firewall customer',
      url: '/msp/clients/client-1',
      acl: { requiredPermission: 'client:read' },
    });
    expect(doc?.sourceUpdatedAt.toISOString()).toBe('2026-05-13T10:00:00.000Z');
  });

  it('T028 client loadBatch maps every seeded tenant client row for backfill', async () => {
    const { knex, queryBuilder } = createBatchKnex([
      {
        client_id: 'client-1',
        client_name: 'ACME Corp',
        email: 'support@acme.example',
        phone_no: null,
        notes: 'First client',
        updated_at: '2026-05-13T10:00:00.000Z',
      },
      {
        client_id: 'client-2',
        client_name: 'Exchange LLC',
        email: null,
        phone_no: '555-0101',
        notes: 'Second client',
        updated_at: '2026-05-13T11:00:00.000Z',
      },
    ]);

    const docs = await clientIndexer.loadBatch(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      undefined,
      500,
    );

    expect(knex).toHaveBeenCalledWith('clients');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'tenant',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('client_id', 'asc');
    expect(queryBuilder.limit).toHaveBeenCalledWith(500);
    expect(docs).toHaveLength(2);
    expect(docs.map((doc) => doc.objectId)).toEqual(['client-1', 'client-2']);
    expect(docs.every((doc) => doc.objectType === 'client')).toBe(true);
    expect(docs.every((doc) => doc.acl.requiredPermission === 'client:read')).toBe(true);
  });

  it('T029 contact subtitle includes email, phone, and role', async () => {
    const { knex, queryBuilder } = createFirstRowKnex({
      contact_name_id: 'contact-1',
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone_number: '555-0110',
      role: 'Primary Contact',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await contactIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'contact-1',
    );

    expect(knex).toHaveBeenCalledWith('contacts');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('contact_name_id', 'contact-1');
    expect(doc).toMatchObject({
      objectType: 'contact',
      objectId: 'contact-1',
      title: 'Ada Lovelace',
      subtitle: 'ada@example.com | 555-0110 | Primary Contact',
      url: '/msp/contacts/contact-1',
      acl: { requiredPermission: 'contact:read' },
    });
  });

  it("T030 user indexer excludes users with user_type='client'", async () => {
    const { knex, queryBuilder } = createFirstRowKnex(undefined);

    const doc = await userIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'user-1',
    );

    expect(knex).toHaveBeenCalledWith('users');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('user_id', 'user-1');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('user_type', 'internal');
    expect(doc).toBeNull();
  });

  it('T031 ticket indexer denormalizes client name and ticket number', async () => {
    const { knex, queryBuilder, joinBuilder } = createFirstRowKnex({
      ticket_id: 'ticket-1',
      ticket_number: 'TIC-1023',
      title: 'Exchange outage',
      client_name: 'ACME Corp',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await ticketIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'ticket-1',
    );

    expect(knex).toHaveBeenCalledWith('tickets as t');
    expect(queryBuilder.leftJoin).toHaveBeenCalledWith('clients as c', expect.any(Function));
    expect(joinBuilder.on).toHaveBeenCalledWith('c.tenant', 't.tenant');
    expect(joinBuilder.andOn).toHaveBeenCalledWith('c.client_id', 't.client_id');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      't.tenant',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('t.ticket_id', 'ticket-1');
    expect(doc).toMatchObject({
      objectType: 'ticket',
      objectId: 'ticket-1',
      title: 'Exchange outage',
      subtitle: 'ACME Corp | TIC-1023',
      url: '/msp/tickets/ticket-1',
      metadata: { identifier: 'TIC-1023' },
      acl: { requiredPermission: 'ticket:read' },
    });
  });

  it('T032 ticket-comment indexer marks internal comments as internal-only', async () => {
    const { knex, queryBuilder, joinBuilder } = createFirstRowKnex({
      comment_id: 'comment-1',
      ticket_id: 'ticket-1',
      note: '**Internal** exchange note',
      is_internal: true,
      ticket_title: 'Exchange outage',
      ticket_number: 'TIC-1023',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await ticketCommentIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'comment-1',
    );

    expect(knex).toHaveBeenCalledWith('comments as c');
    expect(queryBuilder.join).toHaveBeenCalledWith('tickets as t', expect.any(Function));
    expect(joinBuilder.on).toHaveBeenCalledWith('t.tenant', 'c.tenant');
    expect(joinBuilder.andOn).toHaveBeenCalledWith('t.ticket_id', 'c.ticket_id');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'c.tenant',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('c.comment_id', 'comment-1');
    expect(doc).toMatchObject({
      objectType: 'ticket_comment',
      objectId: 'comment-1',
      parentType: 'ticket',
      parentId: 'ticket-1',
      title: 'Exchange outage',
      subtitle: 'TIC-1023',
      body: 'Internal exchange note',
      acl: {
        requiredPermission: 'ticket:read',
        isInternalOnly: true,
      },
    });
  });

  it('T033 ticket-comment indexer links to the comment hash anchor', async () => {
    const { knex } = createFirstRowKnex({
      comment_id: 'comment-42',
      ticket_id: 'ticket-99',
      note: 'Public comment',
      is_internal: false,
      ticket_title: 'Printer issue',
      ticket_number: 'TIC-2042',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await ticketCommentIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'comment-42',
    );

    expect(doc?.url).toBe('/msp/tickets/ticket-99#comment-comment-42');
  });

  it("T034 project indexer sets client_scope_id to the project's client_id", async () => {
    const { knex, queryBuilder } = createFirstRowKnex({
      project_id: 'project-1',
      project_name: 'Exchange rollout',
      description: 'Tenant migration project',
      client_id: 'client-1',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await projectIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'project-1',
    );

    expect(knex).toHaveBeenCalledWith('projects');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('project_id', 'project-1');
    expect(doc).toMatchObject({
      objectType: 'project',
      objectId: 'project-1',
      title: 'Exchange rollout',
      body: 'Tenant migration project',
      url: '/msp/projects/project-1',
      acl: {
        requiredPermission: 'project:read',
        clientScopeId: 'client-1',
      },
    });
  });

  it('T035 project phase and task indexers inherit parent project ACL fields', async () => {
    const phaseKnex = createFirstRowKnex({
      phase_id: 'phase-1',
      project_id: 'project-1',
      phase_name: 'Discovery',
      description: 'Initial discovery',
      project_name: 'Exchange rollout',
      client_id: 'client-1',
      updated_at: '2026-05-13T10:00:00.000Z',
    });
    const taskKnex = createFirstRowKnex({
      task_id: 'task-1',
      phase_id: 'phase-1',
      project_id: 'project-1',
      task_name: 'Inventory mailboxes',
      description: 'Collect mailbox list',
      project_name: 'Exchange rollout',
      client_id: 'client-1',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const phaseDoc = await projectPhaseIndexer.loadOne(
      phaseKnex.knex as never,
      '11111111-1111-4111-8111-111111111111',
      'phase-1',
    );
    const taskDoc = await projectTaskIndexer.loadOne(
      taskKnex.knex as never,
      '11111111-1111-4111-8111-111111111111',
      'task-1',
    );

    expect(phaseKnex.knex).toHaveBeenCalledWith('project_phases as ph');
    expect(taskKnex.knex).toHaveBeenCalledWith('project_tasks as pt');
    expect(phaseDoc).toMatchObject({
      objectType: 'project_phase',
      parentType: 'project',
      parentId: 'project-1',
      subtitle: 'Exchange rollout',
      acl: {
        requiredPermission: 'project:read',
        clientScopeId: 'client-1',
      },
    });
    expect(taskDoc).toMatchObject({
      objectType: 'project_task',
      parentType: 'project',
      parentId: 'project-1',
      subtitle: 'Exchange rollout',
      acl: {
        requiredPermission: 'project:read',
        clientScopeId: 'client-1',
      },
    });
  });

  it('T036 project-task-comment indexer prefers markdown_content over BlockNote note', async () => {
    const { knex } = createFirstRowKnex({
      task_comment_id: 'task-comment-1',
      task_id: 'task-1',
      note: JSON.stringify([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'BlockNote fallback text' }],
        },
      ]),
      markdown_content: 'Markdown content wins',
      task_name: 'Inventory mailboxes',
      project_id: 'project-1',
      project_name: 'Exchange rollout',
      client_id: 'client-1',
      edited_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await projectTaskCommentIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'task-comment-1',
    );

    expect(doc).toMatchObject({
      objectType: 'project_task_comment',
      objectId: 'task-comment-1',
      parentType: 'project_task',
      parentId: 'task-1',
      body: 'Markdown content wins',
      acl: {
        requiredPermission: 'project:read',
        clientScopeId: 'client-1',
      },
    });
  });

  it('T037 project-task-comment indexer falls back to flattened BlockNote note', async () => {
    const { knex } = createFirstRowKnex({
      task_comment_id: 'task-comment-2',
      task_id: 'task-1',
      note: JSON.stringify([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Flattened BlockNote text' }],
        },
      ]),
      markdown_content: null,
      task_name: 'Inventory mailboxes',
      project_id: 'project-1',
      project_name: 'Exchange rollout',
      client_id: 'client-1',
      edited_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await projectTaskCommentIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'task-comment-2',
    );

    expect(doc?.body).toBe('Flattened BlockNote text');
  });

  it('T038 asset indexer body includes flattened attributes but excludes secret-like keys', async () => {
    const { knex } = createFirstRowKnex({
      asset_id: 'asset-1',
      name: 'Firewall',
      asset_tag: 'FW-001',
      serial_number: 'SN-001',
      location: 'Server room',
      attributes: {
        model: 'Fortigate 60F',
        management: {
          ip: '10.0.0.1',
          password: 'do-not-index-password',
        },
      },
      client_id: 'client-1',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await assetIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'asset-1',
    );

    expect(doc?.body).toBe('Server room | Fortigate 60F 10.0.0.1');
    expect(doc?.body).not.toContain('password');
    expect(doc?.body).not.toContain('do-not-index');
  });

  it('T039 asset indexer metadata.identifier equals asset_tag', async () => {
    const { knex } = createFirstRowKnex({
      asset_id: 'asset-2',
      name: 'Technician laptop',
      asset_tag: 'LAP-0042',
      serial_number: 'SN-0042',
      location: null,
      attributes: {},
      client_id: 'client-1',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await assetIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'asset-2',
    );

    expect(doc?.metadata).toEqual({ identifier: 'LAP-0042' });
  });

  it('T040 invoice indexer denormalizes client name and invoice identifier', async () => {
    const { knex, queryBuilder, joinBuilder } = createFirstRowKnex({
      invoice_id: 'invoice-1',
      invoice_number: 'INV-1001',
      client_id: 'client-1',
      client_name: 'ACME Corp',
      total_amount: '1250.00',
      status: 'sent',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await invoiceIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'invoice-1',
    );

    expect(knex).toHaveBeenCalledWith('invoices as i');
    expect(queryBuilder.leftJoin).toHaveBeenCalledWith('clients as c', expect.any(Function));
    expect(joinBuilder.on).toHaveBeenCalledWith('c.tenant', 'i.tenant');
    expect(joinBuilder.andOn).toHaveBeenCalledWith('c.client_id', 'i.client_id');
    expect(doc).toMatchObject({
      objectType: 'invoice',
      objectId: 'invoice-1',
      title: 'INV-1001',
      subtitle: 'ACME Corp | sent | 1250.00',
      url: '/msp/invoices/invoice-1',
      metadata: { identifier: 'INV-1001' },
      acl: {
        requiredPermission: 'invoice:read',
        clientScopeId: 'client-1',
      },
    });
  });

  it('T041 invoice item and annotation indexers inherit invoice ACL fields', async () => {
    const itemKnex = createFirstRowKnex({
      item_id: 'item-1',
      invoice_id: 'invoice-1',
      description: 'Managed service line',
      invoice_number: 'INV-1001',
      client_id: 'client-1',
      updated_at: '2026-05-13T10:00:00.000Z',
    });
    const annotationKnex = createFirstRowKnex({
      annotation_id: 'annotation-1',
      invoice_id: 'invoice-1',
      content: 'Billing note',
      is_internal: false,
      invoice_number: 'INV-1001',
      client_id: 'client-1',
      created_at: '2026-05-13T10:00:00.000Z',
    });

    const itemDoc = await invoiceItemIndexer.loadOne(
      itemKnex.knex as never,
      '11111111-1111-4111-8111-111111111111',
      'item-1',
    );
    const annotationDoc = await invoiceAnnotationIndexer.loadOne(
      annotationKnex.knex as never,
      '11111111-1111-4111-8111-111111111111',
      'annotation-1',
    );

    expect(itemKnex.knex).toHaveBeenCalledWith('invoice_items as ii');
    expect(annotationKnex.knex).toHaveBeenCalledWith('invoice_annotations as ia');
    expect(itemDoc).toMatchObject({
      objectType: 'invoice_item',
      parentType: 'invoice',
      parentId: 'invoice-1',
      title: 'INV-1001',
      url: '/msp/invoices/invoice-1#item-item-1',
      acl: {
        requiredPermission: 'invoice:read',
        clientScopeId: 'client-1',
      },
    });
    expect(annotationDoc).toMatchObject({
      objectType: 'invoice_annotation',
      parentType: 'invoice',
      parentId: 'invoice-1',
      title: 'INV-1001',
      url: '/msp/invoices/invoice-1#annotation-annotation-1',
      acl: {
        requiredPermission: 'invoice:read',
        clientScopeId: 'client-1',
      },
    });
  });

  it("T042 contract indexer labels draft contracts as 'Quote'", async () => {
    const { knex } = createFirstRowKnex({
      contract_id: 'contract-1',
      contract_name: 'ACME renewal quote',
      contract_description: 'Draft renewal terms',
      status: 'draft',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await contractIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'contract-1',
    );

    expect(doc).toMatchObject({
      objectType: 'contract',
      title: 'ACME renewal quote',
      subtitle: 'Quote',
      body: 'Draft renewal terms',
      metadata: { identifier: 'ACME renewal quote' },
      acl: { requiredPermission: 'contract:read' },
    });
  });

  it("T043 contract indexer labels active contracts as 'Contract'", async () => {
    const { knex } = createFirstRowKnex({
      contract_id: 'contract-2',
      contract_name: 'ACME managed services',
      contract_description: 'Active managed services agreement',
      status: 'active',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await contractIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'contract-2',
    );

    expect(doc?.subtitle).toBe('Contract');
  });

  it('T044 document indexer caps large BlockNote content at 65536 bytes', async () => {
    const largeContent = JSON.stringify([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'a'.repeat(70_000) }],
      },
    ]);
    const { knex } = createFirstRowKnex({
      document_id: 'document-1',
      document_name: 'Large runbook',
      content: largeContent,
      client_id: null,
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await documentIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'document-1',
    );

    expect(Buffer.byteLength(doc?.body ?? '', 'utf8')).toBeLessThanOrEqual(65_536);
    expect(doc?.body).toHaveLength(65_536);
  });

  it('T045 document indexer sets client scope and leaves private ACL hints unset', async () => {
    const { knex } = createFirstRowKnex({
      document_id: 'document-2',
      document_name: 'Client runbook',
      content: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Runbook' }] }]),
      client_id: 'client-1',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await documentIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'document-2',
    );

    expect(doc?.acl).toMatchObject({
      requiredPermission: 'document:read',
      clientScopeId: 'client-1',
    });
    expect(doc?.acl).not.toHaveProperty('isPrivate');
    expect(doc?.acl).not.toHaveProperty('visibleToUserIds');
  });

  it('T046 KB article indexer pulls title and content through the document join', async () => {
    const { knex, queryBuilder, joinBuilder } = createFirstRowKnex({
      article_id: 'article-1',
      document_id: 'document-1',
      document_name: 'Exchange runbook',
      content: JSON.stringify([
        { type: 'paragraph', content: [{ type: 'text', text: 'Restart transport service' }] },
      ]),
      updated_at: null,
      document_updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await kbArticleIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'article-1',
    );

    expect(knex).toHaveBeenCalledWith('kb_articles as ka');
    expect(queryBuilder.join).toHaveBeenCalledWith('documents as d', expect.any(Function));
    expect(joinBuilder.on).toHaveBeenCalledWith('d.tenant', 'ka.tenant');
    expect(joinBuilder.andOn).toHaveBeenCalledWith('d.document_id', 'ka.document_id');
    expect(doc).toMatchObject({
      objectType: 'kb_article',
      objectId: 'article-1',
      parentType: 'document',
      parentId: 'document-1',
      title: 'Exchange runbook',
      body: 'Restart transport service',
      url: '/msp/knowledge-base/article-1',
      acl: { requiredPermission: 'kb:read' },
    });
  });

  it('T047 service catalog indexer includes flattened attributes in body', async () => {
    const { knex } = createFirstRowKnex({
      service_id: 'service-1',
      service_name: 'Managed firewall',
      description: 'Monthly firewall management',
      attributes: {
        vendor: 'Fortinet',
        tier: 'Advanced',
      },
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await serviceCatalogIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'service-1',
    );

    expect(knex).toHaveBeenCalledWith('service_catalog');
    expect(doc).toMatchObject({
      objectType: 'service_catalog',
      objectId: 'service-1',
      title: 'Managed firewall',
      body: 'Monthly firewall management | Fortinet Advanced',
      url: '/msp/billing/services/service-1',
      acl: { requiredPermission: 'service_catalog:read' },
    });
  });

  it('T048 service-request-submission indexer flattens payload and excludes secrets', async () => {
    const { knex } = createFirstRowKnex({
      submission_id: 'submission-1',
      client_id: 'client-1',
      request_name: 'New firewall request',
      submitted_payload: {
        summary: 'Need managed firewall',
        contact: { name: 'Ada Lovelace' },
        password: 'do-not-index-password',
      },
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await serviceRequestSubmissionIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'submission-1',
    );

    expect(doc).toMatchObject({
      objectType: 'service_request_submission',
      objectId: 'submission-1',
      title: 'New firewall request',
      body: 'Need managed firewall Ada Lovelace',
      url: '/msp/service-requests/submission-1',
      acl: {
        requiredPermission: 'service_request:read',
        clientScopeId: 'client-1',
      },
    });
    expect(doc?.body).not.toContain('do-not-index');
  });

  it('T049 service-request-definition indexer requires admin permission', async () => {
    const { knex } = createFirstRowKnex({
      definition_id: 'definition-1',
      name: 'Firewall onboarding',
      description: 'Admin-managed definition',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await serviceRequestDefinitionIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'definition-1',
    );

    expect(doc).toMatchObject({
      objectType: 'service_request_definition',
      objectId: 'definition-1',
      title: 'Firewall onboarding',
      body: 'Admin-managed definition',
      url: '/msp/service-requests/definitions/definition-1',
      acl: { requiredPermission: 'admin' },
    });
  });

  it('T050 workflow-task indexer populates visible_to_user_ids from assigned_users', async () => {
    const { knex } = createFirstRowKnex({
      task_id: 'workflow-task-1',
      title: 'Approve onboarding',
      description: 'Review service request',
      assigned_users: [
        { user_id: '11111111-1111-4111-8111-111111111111' },
        { userId: '22222222-2222-4222-8222-222222222222' },
        '11111111-1111-4111-8111-111111111111',
      ],
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await workflowTaskIndexer.loadOne(
      knex as never,
      'tenant-1',
      'workflow-task-1',
    );

    expect(doc).toMatchObject({
      objectType: 'workflow_task',
      objectId: 'workflow-task-1',
      title: 'Approve onboarding',
      body: 'Review service request',
      url: '/msp/workflow-tasks/workflow-task-1',
      acl: {
        requiredPermission: 'workflow_task:read',
        visibleToUserIds: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      },
    });
  });
});
