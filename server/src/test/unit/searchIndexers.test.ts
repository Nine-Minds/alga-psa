import { describe, expect, it, vi } from 'vitest';

import { assetIndexer } from '../../lib/search/indexers/asset';
import { clientIndexer } from '../../lib/search/indexers/client';
import { contactIndexer } from '../../lib/search/indexers/contact';
import { projectPhaseIndexer } from '../../lib/search/indexers/project_phase';
import { projectTaskCommentIndexer } from '../../lib/search/indexers/project_task_comment';
import { projectTaskIndexer } from '../../lib/search/indexers/project_task';
import { projectIndexer } from '../../lib/search/indexers/project';
import { ticketIndexer } from '../../lib/search/indexers/ticket';
import { ticketCommentIndexer } from '../../lib/search/indexers/ticket_comment';
import { userIndexer } from '../../lib/search/indexers/user';

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
});
